import { Router } from 'express';
import { db } from '../db.js';
import { verifyAccessToken } from '../auth.js';
import { todayUtc, puzzleNumber } from '../words.js';
import { touch, onlineCount, peakCount } from '../presence.js';
import { supporterIds } from '../supporters.js';

export const leaderboardRouter = Router();

/** GET /api/leaderboard?scope=all|today — top 100 joueurs. */
leaderboardRouter.get('/leaderboard', (req, res) => {
  const scope = req.query.scope === 'today' ? 'today' : 'all';
  const date = todayUtc();

  const rows =
    scope === 'today'
      ? db
          .prepare(
            `SELECT u.id, u.username, u.is_premium, r.score AS total, r.attempts, r.seconds, 1 AS days
             FROM daily_results r JOIN users u ON u.id = r.user_id
             WHERE r.date = ? AND r.outcome = 'found'
             ORDER BY r.score DESC, r.seconds ASC LIMIT 100`
          )
          .all(date)
      : db
          .prepare(
            `SELECT u.id, u.username, u.is_premium, SUM(r.score) AS total, COUNT(*) AS days,
                    MIN(r.attempts) AS attempts, MIN(r.seconds) AS seconds
             FROM daily_results r JOIN users u ON u.id = r.user_id
             WHERE r.outcome = 'found'
             GROUP BY u.id ORDER BY total DESC LIMIT 100`
          )
          .all();

  // Un seul appel, plutot qu'une requete par ligne de classement.
  const soutiens = supporterIds();

  const entries = rows.map((r, i) => ({
    position: i + 1,
    userId: r.id,
    username: r.username,
    // Le classement reste strictement au mérite : le badge est décoratif,
    // il n'entre dans aucun tri.
    isPremium: Boolean(r.is_premium),
    isSupporter: soutiens.has(r.id),
    total: r.total,
    days: r.days,
    bestAttempts: r.attempts,
    bestSeconds: r.seconds,
  }));

  // Position du joueur courant, s'il est authentifié
  let me = null;
  const header = req.headers.authorization || '';
  const payload = header.startsWith('Bearer ') ? verifyAccessToken(header.slice(7)) : null;
  if (payload) {
    const found = entries.find((e) => e.userId === payload.sub);
    me = found || { position: null, userId: payload.sub, username: payload.username, total: 0, days: 0 };
  }

  res.json({ scope, date, puzzleNumber: puzzleNumber(date), entries, me });
});

/** POST /api/presence — ping de présence, renvoie le nombre de connectés. */
leaderboardRouter.post('/presence', (req, res) => {
  touch(String(req.body?.id || ''));
  res.json({ online: onlineCount() });
});

/** GET /api/stats/global — chiffres d'accueil. */
leaderboardRouter.get('/stats/global', (req, res) => {
  const date = todayUtc();
  const players = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const solvedToday = db
    .prepare("SELECT COUNT(*) AS n FROM daily_results WHERE date = ? AND outcome = 'found'")
    .get(date).n;
  const guessesToday = db.prepare('SELECT COUNT(*) AS n FROM guesses WHERE date = ?').get(date).n;
  const best = db
    .prepare(
      `SELECT u.username, r.score FROM daily_results r JOIN users u ON u.id = r.user_id
       WHERE r.date = ? AND r.outcome = 'found' ORDER BY r.score DESC LIMIT 1`
    )
    .get(date);

  res.json({
    players,
    solvedToday,
    guessesToday,
    online: onlineCount(),
    peak: peakCount(),
    puzzleNumber: puzzleNumber(date),
    bestToday: best ? { username: best.username, score: best.score } : null,
  });
});
