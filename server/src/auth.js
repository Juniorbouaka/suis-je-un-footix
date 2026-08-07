import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config, isAdminEmail } from './config.js';
import { db } from './db.js';
import { expireIfNeeded } from './billing.js';
import { canUseTheme, DEFAULT_THEME } from './themes.js';
import { isSupporter } from './supporters.js';

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessTtl,
  });
}

export function issueRefreshToken(userId) {
  const token = jwt.sign({ sub: userId, jti: crypto.randomUUID() }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshTtl,
  });
  const { exp } = jwt.decode(token);
  db.prepare('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    new Date(exp * 1000).toISOString()
  );
  return token;
}

export function rotateRefreshToken(oldToken) {
  const stored = db.prepare('SELECT * FROM refresh_tokens WHERE token = ?').get(oldToken);
  if (!stored) return null;
  let payload;
  try {
    payload = jwt.verify(oldToken, config.jwt.refreshSecret);
  } catch {
    db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(oldToken);
    return null;
  }
  db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(oldToken);
  return { userId: payload.sub, refreshToken: issueRefreshToken(payload.sub) };
}

export function revokeRefreshToken(token) {
  db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(token);
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwt.accessSecret);
  } catch {
    return null;
  }
}

export function findUserById(id) {
  const row = db
    .prepare(
      `SELECT id, username, email, avatar_url, stats_json, is_premium, is_subscriber,
              created_at, subscription_provider, subscription_id, subscription_status,
              subscription_plan, premium_until, pitch_theme,
              last_login_at, last_seen_at
         FROM users WHERE id = ?`
    )
    .get(id);
  if (!row) return null;
  // Point unique d'expiration du premium : toute requête authentifiée passe
  // ici, aucune tâche planifiée n'est donc nécessaire.
  const user = expireIfNeeded({ ...row });

  /*
   * Un administrateur a tous les droits, sans abonnement et sans écriture en
   * base. Celui qui paie l'API du jeu n'a pas à s'abonner à son propre jeu,
   * et il doit pouvoir vérifier ce que voient ses abonnés.
   *
   * `is_subscriber` autant que `is_premium` : depuis que le jeu est payant,
   * oublier le premier enfermerait l'administrateur dehors — il verrait le
   * mur de paiement sur son propre site.
   *
   * Le droit vient de ADMIN_EMAILS, comme l'accès au tableau de bord :
   * retirer l'adresse de la variable retire les deux d'un coup, et aucune
   * ligne de la base ne reste à nettoyer.
   */
  return isAdmin(user) ? { ...user, is_premium: 1, is_subscriber: 1 } : user;
}

/**
 * Ce compte a-t-il le droit d'entrer dans le jeu ?
 *
 * `is_premium` est relu en plus de `is_subscriber` par prudence : un premium
 * accordé à la main avant la bascule tarifaire, ou une base restaurée d'une
 * sauvegarde ancienne, pourraient porter l'un sans l'autre. Entre laisser
 * jouer quelqu'un qui a payé et le renvoyer à la caisse, le doute profite
 * au joueur.
 */
export function hasPaidAccess(user) {
  return Boolean(user?.is_subscriber || user?.is_premium);
}

/**
 * Droit d'administration : la liste blanche d'adresses vaut décision.
 * Aucun drapeau en base, donc rien à corriger si la base est restaurée
 * depuis une sauvegarde, et aucune écriture ne peut promouvoir un compte.
 */
export function isAdmin(user) {
  return isAdminEmail(user?.email);
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatar_url || null,
    // Deux droits distincts : entrer dans le jeu, et avoir le forfait haut.
    // Le client se sert du premier pour savoir s'il affiche le jeu ou le mur.
    hasAccess: hasPaidAccess(user),
    isPremium: Boolean(user.is_premium),
    plan: user.subscription_plan || null,
    isAdmin: isAdmin(user),
    // Un don encaisse, quelle qu'en soit la date : contrairement au
    // premium, un merci n'a pas d'echeance.
    isSupporter: isSupporter(user.id),
    // Un abonnement expiré ne doit pas laisser un thème premium actif :
    // on retombe sur le thème libre sans rien effacer, le choix est
    // retrouvé tel quel en cas de réabonnement.
    pitchTheme: canUseTheme(user.pitch_theme, user.is_premium)
      ? user.pitch_theme
      : DEFAULT_THEME,
    createdAt: user.created_at,
  };
}

/* -------------------------------------------------------------- *
 *  Journal de connexion
 * -------------------------------------------------------------- */

/** SQLite écrit « 2026-08-05 10:12:00 » en UTC, sans marqueur de fuseau. */
function parseSqliteDate(value) {
  if (!value) return 0;
  const iso = value.includes('T') ? value : value.replace(' ', 'T');
  return Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`) || 0;
}

// Une écriture au plus toutes les 5 minutes par joueur : la date sert à
// mesurer une activité quotidienne, pas à la seconde près, et une partie
// génère une requête par tentative.
const SEEN_THROTTLE_MS = 5 * 60 * 1000;

export function markSeen(user) {
  if (Date.now() - parseSqliteDate(user.last_seen_at) < SEEN_THROTTLE_MS) return;
  db.prepare("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?").run(user.id);
}

/** Enregistre une connexion : date sur le compte + ligne dans le journal. */
export function recordLogin(userId, kind = 'login') {
  db.prepare("UPDATE users SET last_login_at = datetime('now'), last_seen_at = datetime('now') WHERE id = ?").run(
    userId
  );
  db.prepare('INSERT INTO login_events (user_id, kind) VALUES (?, ?)').run(userId, kind);
}

/** Middleware Express : exige un access token valide. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && verifyAccessToken(token);
  if (!payload) return res.status(401).json({ error: 'Authentification requise.' });

  const user = findUserById(payload.sub);
  if (!user) return res.status(401).json({ error: 'Compte introuvable.' });

  markSeen(user);
  req.user = user;
  next();
}

/**
 * Middleware Express : exige un abonnement en cours.
 *
 * C'est le mur de paiement, et il tient à un seul endroit. Toute route qui
 * fait jouer — donc toute route qui appelle l'API Claude et coûte de
 * l'argent — passe par ici. Le client a beau masquer les boutons, c'est
 * cette ligne qui décide : une page cachée n'a jamais empêché personne
 * d'appeler l'API à la main.
 *
 * 402 « Payment Required » et non 403 : le client sait alors qu'il ne s'agit
 * pas d'un droit manquant mais d'un abonnement à prendre, et renvoie vers
 * l'offre plutôt que vers un message d'erreur sans issue. Les autres refus
 * payants du jeu (thèmes, statistiques détaillées) répondent déjà 402, la
 * lecture du code du statut reste donc uniforme.
 */
export function requirePaidAccess(req, res, next) {
  requireAuth(req, res, () => {
    if (!hasPaidAccess(req.user)) {
      return res.status(402).json({
        error: 'Le jeu est réservé aux abonnés. Choisis ta formule pour commencer à jouer.',
        needsSubscription: true,
      });
    }
    next();
  });
}

/**
 * Middleware Express : exige un compte administrateur.
 *
 * On répond 404 et non 403 : une route d'administration ne doit pas
 * confirmer son existence à qui n'y a pas droit.
 */
export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!isAdmin(req.user)) return res.status(404).json({ error: 'Route introuvable.' });
    next();
  });
}

/**
 * Authentification d'un handshake Socket.io.
 *
 * Le mur de paiement est posé ici, à l'entrée de la socket, et non sur
 * chacun des événements de duel. C'est le seul point de passage obligé :
 * matchmaking, invitation, reprise de partie, tout arrive par cette poignée
 * de main. Refuser là, c'est refuser partout, et aucun événement ajouté
 * demain ne pourra passer à travers par oubli.
 */
export function authenticateSocket(socket, next) {
  const token = socket.handshake.auth?.token;
  const payload = token && verifyAccessToken(token);
  if (!payload) return next(new Error('Authentification requise.'));
  const user = findUserById(payload.sub);
  if (!user) return next(new Error('Compte introuvable.'));
  if (!hasPaidAccess(user)) {
    // Le message est lu tel quel par le client : il doit s'afficher à un
    // joueur, pas à un développeur.
    const err = new Error('Les duels sont réservés aux abonnés.');
    err.data = { needsSubscription: true };
    return next(err);
  }
  socket.data.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    isPremium: Boolean(user.is_premium),
    isSupporter: isSupporter(user.id),
  };
  next();
}
