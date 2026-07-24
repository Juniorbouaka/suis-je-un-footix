import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  requireAuth,
  publicUser,
  findUserById,
} from '../auth.js';
import { readStats, rankFor } from '../scoring.js';
import { config } from '../config.js';
import { sendMail, resetEmail } from '../mailer.js';
import { listFor } from '../achievements.js';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessaie dans quelques minutes.' },
});

function validateSignup({ username, email, password }) {
  if (!username || username.length < 3 || username.length > 20) {
    return 'Le pseudo doit contenir entre 3 et 20 caractères.';
  }
  if (!/^[\p{L}\p{N}_-]+$/u.test(username)) {
    return 'Le pseudo ne peut contenir que des lettres, chiffres, tirets et underscores.';
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Adresse e-mail invalide.';
  }
  if (!password || password.length < 8) {
    return 'Le mot de passe doit contenir au moins 8 caractères.';
  }
  return null;
}

authRouter.post('/signup', authLimiter, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  const error = validateSignup({ username, email, password });
  if (error) return res.status(400).json({ error });

  const taken = db
    .prepare('SELECT id FROM users WHERE lower(username) = lower(?) OR email = ?')
    .get(username, email);
  if (taken) return res.status(409).json({ error: 'Pseudo ou e-mail déjà utilisé.' });

  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO users (id, username, email, password_hash, stats_json) VALUES (?, ?, ?, ?, ?)'
  ).run(id, username, email, hashPassword(password), '{}');

  const user = findUserById(id);
  res.status(201).json({
    user: publicUser(user),
    accessToken: signAccessToken(user),
    refreshToken: issueRefreshToken(id),
  });
});

authRouter.post('/login', authLimiter, (req, res) => {
  const identifier = String(req.body?.identifier || req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
  }

  const row = db
    .prepare('SELECT * FROM users WHERE email = ? OR lower(username) = ?')
    .get(identifier, identifier);

  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }

  res.json({
    user: publicUser(row),
    accessToken: signAccessToken(row),
    refreshToken: issueRefreshToken(row.id),
  });
});

authRouter.post('/refresh', (req, res) => {
  const token = String(req.body?.refreshToken || '');
  const rotated = rotateRefreshToken(token);
  if (!rotated) return res.status(401).json({ error: 'Session expirée. Reconnecte-toi.' });

  const user = findUserById(rotated.userId);
  if (!user) return res.status(401).json({ error: 'Compte introuvable.' });

  res.json({
    user: publicUser(user),
    accessToken: signAccessToken(user),
    refreshToken: rotated.refreshToken,
  });
});

authRouter.post('/logout', (req, res) => {
  const token = String(req.body?.refreshToken || '');
  if (token) revokeRefreshToken(token);
  res.json({ ok: true });
});

/* -------------------------------------------------------------- *
 *  Mot de passe oublié
 * -------------------------------------------------------------- */

// Demander un lien coûte un e-mail : quota serré.
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de demandes. Réessaie dans une heure.' },
});

// Valider un lien exige déjà un jeton valide : quota plus large, sinon un
// joueur qui a demandé plusieurs liens ne pourrait plus utiliser le dernier.
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessaie dans une heure.' },
});

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

authRouter.post('/forgot-password', forgotLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();

  // Réponse identique dans tous les cas : sinon, cette route permettrait de
  // découvrir quelles adresses sont inscrites.
  const generic = {
    ok: true,
    message: 'Si un compte existe pour cette adresse, un e-mail vient de partir.',
  };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json(generic);

  const user = db.prepare('SELECT id, username, email FROM users WHERE email = ?').get(email);
  if (!user) return res.json(generic);

  // Seul le hash du jeton est stocké : une fuite de la base ne permet pas
  // de réinitialiser les mots de passe.
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
  db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    hashToken(token),
    user.id,
    expires
  );

  const link = `${config.publicUrl}/reinitialiser?token=${token}`;
  const { subject, text } = resetEmail({ username: user.username, link });
  await sendMail({ to: user.email, subject, text });

  res.json(generic);
});

authRouter.post('/reset-password', resetLimiter, (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');

  if (password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
  }

  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(hashToken(token));
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Lien invalide ou expiré. Refais une demande.' });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.user_id);
  db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE token_hash = ?").run(row.token_hash);
  // Toutes les sessions ouvertes sont invalidées : si un intrus était connecté,
  // il est éjecté par le changement de mot de passe.
  db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(row.user_id);

  res.json({ ok: true, message: 'Mot de passe modifié. Tu peux te reconnecter.' });
});

/* -------------------------------------------------------------- *
 *  Suppression de compte (obligation RGPD)
 * -------------------------------------------------------------- */

authRouter.delete('/me', requireAuth, (req, res) => {
  const password = String(req.body?.password || '');
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);

  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(403).json({ error: 'Mot de passe incorrect.' });
  }

  // Les clés étrangères sont en ON DELETE CASCADE : parties, tentatives,
  // médailles, duels et sessions partent avec le compte.
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);

  res.json({ ok: true, message: 'Compte et données supprimés.' });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const stats = readStats(req.user.id);
  res.json({
    user: publicUser(req.user),
    stats,
    rank: rankFor(stats),
    achievements: listFor(req.user.id),
  });
});
