import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });

export const db = new DatabaseSync(config.databaseFile);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_url    TEXT,
  stats_json    TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_words (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL UNIQUE,
  word       TEXT NOT NULL,
  category   TEXT,
  difficulty INTEGER NOT NULL DEFAULT 3
);

CREATE TABLE IF NOT EXISTS guesses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date           TEXT NOT NULL,
  word_guessed   TEXT NOT NULL,
  score          INTEGER NOT NULL,
  feedback       TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_guesses_user_date ON guesses(user_id, date);

CREATE TABLE IF NOT EXISTS daily_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  attempts    INTEGER NOT NULL,
  seconds     INTEGER NOT NULL,
  score       INTEGER NOT NULL,
  surrendered INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS multiplay_games (
  id             TEXT PRIMARY KEY,
  player_a_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_b_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_a_secret TEXT NOT NULL,
  player_b_secret TEXT NOT NULL,
  winner_id      TEXT,
  started_at     TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at       TEXT,
  duration_ms    INTEGER
);

-- Le quota de duels quotidiens compte les parties du jour d'un joueur.
CREATE INDEX IF NOT EXISTS idx_multiplay_players ON multiplay_games(player_a_id, player_b_id);

CREATE TABLE IF NOT EXISTS multiplay_guesses (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id                TEXT NOT NULL REFERENCES multiplay_games(id) ON DELETE CASCADE,
  player_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_guessed           TEXT NOT NULL,
  opponent_secret_score  INTEGER NOT NULL,
  attempt_number         INTEGER NOT NULL,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS achievements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  earned_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, code)
);

CREATE TABLE IF NOT EXISTS proximity_cache (
  key         TEXT PRIMARY KEY,
  score       INTEGER NOT NULL,
  explanation TEXT NOT NULL,
  source      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS word_descriptions (
  word       TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  source     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/* ------------------------------------------------------------------ *
 *  Migrations légères : ajout de colonnes sur des bases déjà créées
 * ------------------------------------------------------------------ */

function addColumn(table, column, definition) {
  const exists = db
    .prepare(`SELECT COUNT(*) AS n FROM pragma_table_info(?) WHERE name = ?`)
    .get(table, column).n;
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Issue de la partie solo : 'found' | 'surrendered' | 'exhausted'
addColumn('daily_results', 'outcome', "TEXT NOT NULL DEFAULT 'found'");
// Forfait Illimité : 50 chances, 5 parties, 5 duels, sans publicité, archives
// complètes. Le nom de la colonne est resté « premium » — le renommer aurait
// touché trente-cinq fichiers pour ne rien changer au comportement.
addColumn('users', 'is_premium', 'INTEGER NOT NULL DEFAULT 0');

/*
 * Le droit d'entrer dans le jeu.
 *
 * Deux drapeaux, deux questions distinctes :
 *   is_subscriber → a-t-il le droit de JOUER ? (forfait Accès ou Illimité)
 *   is_premium    → a-t-il le forfait Illimité ?
 *
 * Un seul drapeau ne suffisait plus le jour où le jeu est devenu payant :
 * `is_premium` répondait « a-t-il payé ? » ET « a-t-il tout payé ? », deux
 * questions qui n'ont plus la même réponse depuis qu'il existe un forfait
 * d'entrée à 2,99 €.
 *
 * La valeur par défaut est 0, y compris pour les comptes déjà en base : la
 * bascule ferme la porte à tout le monde, l'abonnement la rouvre. C'était la
 * décision — 981 comptes gratuits n'ont rapporté aucun don en plusieurs mois.
 */
addColumn('users', 'is_subscriber', 'INTEGER NOT NULL DEFAULT 0');

/*
 * Abonnement.
 *
 * `premium_until` est la date de fin des droits — de TOUS les droits, quel
 * que soit le forfait. Une résiliation ne coupe pas l'accès immédiatement :
 * le joueur a payé sa période, il la termine. `is_subscriber` et
 * `is_premium` sont les drapeaux effectifs, remis à 0 automatiquement à
 * l'expiration (voir expireIfNeeded, appelé par findUserById dans auth.js).
 */
addColumn('users', 'subscription_provider', 'TEXT'); // 'paypal' | 'stripe' | 'manuel'
addColumn('users', 'subscription_id', 'TEXT');
addColumn('users', 'subscription_status', 'TEXT'); // ACTIVE | CANCELLED | SUSPENDED | EXPIRED
addColumn('users', 'subscription_plan', 'TEXT'); // 'access' | 'unlimited'
addColumn('users', 'premium_until', 'TEXT');

/*
 * Les crédits.
 *
 * `credits` est le solde, `credits_renewed_at` la date du dernier
 * rechargement et `credits_period_end` celle du prochain — ce que le joueur
 * lit quand son solde est à zéro. Le journal `credit_events` garde la trace
 * de chaque mouvement : sans lui, un joueur qui écrit « j'ai perdu trois
 * crédits sans jouer » est une accusation qu'on ne peut ni vérifier ni
 * démentir. Un compteur d'argent sans relevé n'est pas un compteur d'argent.
 */
addColumn('users', 'credits', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'credits_renewed_at', 'TEXT');
addColumn('users', 'credits_period_end', 'TEXT');

db.exec(`
CREATE TABLE IF NOT EXISTS credit_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  ref        TEXT,
  balance    INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_credit_events_user ON credit_events (user_id, id DESC);
`);

/*
 * Reprise des abonnés d'avant la bascule tarifaire.
 *
 * Deux réparations, rejouées à chaque démarrage parce qu'elles énoncent des
 * invariants et non des étapes : les rejouer ne peut rien casser, et une
 * base restaurée depuis une sauvegarde se remet d'aplomb toute seule.
 *
 *   1. Un compte premium a forcément le droit d'entrer. Sans cette ligne, la
 *      colonne `is_subscriber` naîtrait à 0 pour TOUT LE MONDE — y compris
 *      pour ceux qui paient déjà, qui se retrouveraient devant le mur au
 *      premier déploiement. Un abonné mis à la porte le jour où l'on
 *      commence à vendre, ce serait la pire manière de lancer l'offre.
 *
 *   2. Les anciennes clés de formule ('monthly', 'yearly') désignaient le
 *      premium complet ; elles deviennent 'unlimited'. Sans ce report, le
 *      premier webhook de renouvellement relirait « monthly », n'y
 *      reconnaîtrait pas le forfait Illimité, et rétrograderait au forfait
 *      Accès un joueur qui n'a rien demandé.
 */
db.exec(`
  UPDATE users SET is_subscriber = 1 WHERE is_premium = 1 AND is_subscriber = 0;
  UPDATE users SET subscription_plan = 'unlimited'
   WHERE subscription_plan IN ('monthly', 'yearly');
`);
// Thème de terrain choisi (réservé au premium au-delà du thème par défaut)
addColumn('users', 'pitch_theme', "TEXT NOT NULL DEFAULT 'classique'");

db.exec(`
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_usage (
  date  TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0
);

/*
 * Journal des événements de facturation.
 * La clé primaire est l'identifiant de l'événement PayPal : un même webhook
 * rejoué (PayPal réessaie jusqu'à 25 fois en cas d'erreur) ne sera traité
 * qu'une seule fois.
 */
CREATE TABLE IF NOT EXISTS billing_events (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  user_id    TEXT,
  payload    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/*
 * Rejeu des journées passées (premium).
 *
 * Tables distinctes de guesses / daily_results à dessein : rejouer une
 * archive ne doit ni écraser le résultat réel de cette journée, ni rapporter
 * de points au classement. Un abonné ne doit jamais pouvoir acheter une
 * place au classement.
 */
CREATE TABLE IF NOT EXISTS archive_guesses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date           TEXT NOT NULL,
  word_guessed   TEXT NOT NULL,
  score          INTEGER NOT NULL,
  feedback       TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_archive_guesses_user_date ON archive_guesses(user_id, date);

/*
 * Dons.
 *
 * Le don est anonyme par défaut et ne demande aucun compte : user_id reste
 * nul pour un visiteur de passage. On ne conserve ni e-mail ni coordonnées
 * — PayPal encaisse, nous ne gardons que la trace comptable, et l'identifiant
 * de commande sert d'idempotence si le visiteur recharge la page de retour.
 */
CREATE TABLE IF NOT EXISTS donations (
  order_id    TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  amount      TEXT NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'EUR',
  status      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  captured_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_donations_user ON donations(user_id, status);

CREATE TABLE IF NOT EXISTS archive_results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  attempts   INTEGER NOT NULL,
  seconds    INTEGER NOT NULL,
  outcome    TEXT NOT NULL DEFAULT 'found',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, date)
);
`);

/*
 * Mur des soutiens.
 *
 * Ces migrations viennent APRÈS le bloc ci-dessus : la table `donations`
 * doit exister avant qu'on lui ajoute des colonnes. Une base déployée avant
 * cette version possède déjà la table sans ces deux champs.
 *
 * Le nom affiché est facultatif et sa publication est un choix explicite :
 * par défaut un don reste anonyme. Personne ne doit se retrouver sur une
 * page publique sans l'avoir demandé.
 */
addColumn('donations', 'display_name', 'TEXT');
addColumn('donations', 'is_public', 'INTEGER NOT NULL DEFAULT 0');

/*
 * Suivi des connexions (tableau de bord d'administration).
 *
 * Deux dates distinctes, parce qu'elles ne racontent pas la même chose :
 * `last_login_at` est la dernière saisie du mot de passe, `last_seen_at` la
 * dernière requête authentifiée — un joueur qui revient tous les jours sans
 * jamais se déconnecter n'a qu'une seule « connexion » mais trente jours
 * d'activité.
 *
 * Le journal ne garde que l'identifiant et l'horodatage : ni adresse IP, ni
 * agent utilisateur. Une donnée qu'on ne collecte pas est une donnée qui ne
 * peut ni fuiter ni être réclamée.
 */
addColumn('users', 'last_login_at', 'TEXT');
addColumn('users', 'last_seen_at', 'TEXT');

/*
 * Palmarès : les vainqueurs des mois écoulés.
 *
 * Le titre est figé une fois le mois terminé, et non recalculé à chaque
 * affichage — c'est ce qui en fait un palmarès plutôt qu'un tri. Le pseudo
 * est recopié dans la table : un compte supprimé ou renommé ne doit pas
 * effacer un mois de l'histoire du jeu, d'où le `ON DELETE SET NULL` sur
 * l'identifiant plutôt qu'une suppression en cascade.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS monthly_champions (
  month     TEXT PRIMARY KEY,
  user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  username  TEXT NOT NULL,
  total     INTEGER NOT NULL,
  days      INTEGER NOT NULL,
  sealed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'login',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_events_date ON login_events(created_at);
`);

/** Petit helper : convertit les null-prototype rows en objets simples. */
export function plain(row) {
  return row ? { ...row } : row;
}
