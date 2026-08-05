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
// Compte premium : sans publicité + accès aux archives
addColumn('users', 'is_premium', 'INTEGER NOT NULL DEFAULT 0');

/*
 * Abonnement premium.
 *
 * `premium_until` est la date de fin des droits. Une résiliation ne coupe
 * pas l'accès immédiatement : le joueur a payé sa période, il la termine.
 * `is_premium` reste le drapeau effectif, remis à 0 automatiquement à
 * l'expiration (voir findUserById dans auth.js).
 */
addColumn('users', 'subscription_provider', 'TEXT'); // 'paypal'
addColumn('users', 'subscription_id', 'TEXT');
addColumn('users', 'subscription_status', 'TEXT'); // ACTIVE | CANCELLED | SUSPENDED | EXPIRED
addColumn('users', 'subscription_plan', 'TEXT'); // 'monthly' | 'yearly'
addColumn('users', 'premium_until', 'TEXT');
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

/** Petit helper : convertit les null-prototype rows en objets simples. */
export function plain(row) {
  return row ? { ...row } : row;
}
