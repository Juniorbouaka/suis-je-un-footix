import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
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
      `SELECT id, username, email, avatar_url, stats_json, is_premium, created_at,
              subscription_provider, subscription_id, subscription_status,
              subscription_plan, premium_until, pitch_theme
         FROM users WHERE id = ?`
    )
    .get(id);
  if (!row) return null;
  // Point unique d'expiration du premium : toute requête authentifiée passe
  // ici, aucune tâche planifiée n'est donc nécessaire.
  return expireIfNeeded({ ...row });
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatar_url || null,
    isPremium: Boolean(user.is_premium),
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

/** Middleware Express : exige un access token valide. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && verifyAccessToken(token);
  if (!payload) return res.status(401).json({ error: 'Authentification requise.' });

  const user = findUserById(payload.sub);
  if (!user) return res.status(401).json({ error: 'Compte introuvable.' });

  req.user = user;
  next();
}

/** Authentification d'un handshake Socket.io. */
export function authenticateSocket(socket, next) {
  const token = socket.handshake.auth?.token;
  const payload = token && verifyAccessToken(token);
  if (!payload) return next(new Error('Authentification requise.'));
  const user = findUserById(payload.sub);
  if (!user) return next(new Error('Compte introuvable.'));
  socket.data.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    isPremium: Boolean(user.is_premium),
    isSupporter: isSupporter(user.id),
  };
  next();
}
