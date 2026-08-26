import { Router } from 'express';
import { db } from '../db.js';
import { verifyAccessToken } from '../auth.js';
import { todayUtc, puzzleNumber } from '../words.js';
import { touch, onlineCount, peakCount } from '../presence.js';
import { supporterIds } from '../supporters.js';
import { currentMonth, monthlyRanking, pastChampions } from '../champions.js';
import { duelTrialTotal, trialTotal } from '../trial.js';

export const leaderboardRouter = Router();

/**
 * GET /api/leaderboard?scope=month|all|hall
 *
 * Trois lectures d'une même histoire : le mois en cours (la course à laquelle
 * on peut encore participer), le cumul de toujours (la carrière) et le
 * palmarès des mois écoulés (ce qui reste quand le mois est fini).
 */
leaderboardRouter.get('/leaderboard', (req, res) => {
  const scope = ['month', 'all', 'hall'].includes(req.query.scope) ? req.query.scope : 'month';
  const date = todayUtc();
  const month = currentMonth();

  // Un seul appel, plutot qu'une requete par ligne de classement.
  const soutiens = supporterIds();

  /* ------------------------- Palmarès --------------------------- */
  if (scope === 'hall') {
    return res.json({
      scope,
      date,
      month,
      champions: pastChampions().map((c) => ({
        month: c.month,
        userId: c.user_id,
        username: c.username,
        isPremium: Boolean(c.is_premium),
        isSupporter: c.user_id ? soutiens.has(c.user_id) : false,
        total: c.total,
        days: c.days,
      })),
    });
  }

  /* --------------------- Mois en cours / général ---------------- */
  const rows =
    scope === 'month'
      ? monthlyRanking(month)
      : db
          .prepare(
            `SELECT u.id, u.username, u.is_premium, SUM(r.score) AS total, COUNT(*) AS days,
                    MIN(r.attempts) AS attempts, MIN(r.seconds) AS seconds
             FROM daily_results r JOIN users u ON u.id = r.user_id
             WHERE r.outcome = 'found'
             GROUP BY u.id ORDER BY total DESC LIMIT 100`
          )
          .all();

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

  res.json({ scope, date, month, puzzleNumber: puzzleNumber(date), entries, me });
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
    /*
     * Le nombre de chances offertes, dans la seule réponse que l'accueil
     * obtienne sans compte.
     *
     * C'est l'argument principal de la page — « 8 chances offertes » — et il
     * s'adresse par définition à quelqu'un qui n'est pas connecté : le lire
     * dans le profil ne servirait à rien, et le figer dans le code du client
     * le ferait mentir le jour où TRIAL_GUESSES change.
     */
    trialGuesses: trialTotal(),
    // Le duel offert, pour la même raison et au même endroit : l'accueil
    // annonce les deux essais avant toute création de compte.
    trialDuels: duelTrialTotal(),
    bestToday: best ? { username: best.username, score: best.score } : null,
  });
});
