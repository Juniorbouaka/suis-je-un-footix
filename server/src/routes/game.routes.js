import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { config, attemptsFor } from '../config.js';
import {
  evaluateProximity,
  feedbackFor,
  normalizeWord,
  validateGuess,
  claudeEnabled,
  describePlayer,
} from '../claude.js';
import { getDailyWord, publicDailyWord, todayUtc, puzzleNumber } from '../words.js';
import { soloScore, recordSoloWin, readStats, rankFor } from '../scoring.js';
import { evaluateSolo, listFor } from '../achievements.js';
import { PITCH_THEMES, DEFAULT_THEME, findTheme, canUseTheme } from '../themes.js';
import { duelQuota } from '../duels.js';

export const gameRouter = Router();

/* -------------------------------------------------------------- *
 *  Limitation de débit : 10 propositions/minute (CDC §8)
 *  + 1 appel/seconde maximum par joueur (CDC §5)
 * -------------------------------------------------------------- */

const guessLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.game.guessesPerMinute,
  // req.ip doit passer par ipKeyGenerator pour normaliser les adresses IPv6.
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Doucement ! 10 propositions par minute maximum.' },
});

const lastGuessAt = new Map();
function throttlePerSecond(req, res, next) {
  const now = Date.now();
  const previous = lastGuessAt.get(req.user.id) || 0;
  if (now - previous < config.game.minGuessIntervalMs) {
    return res.status(429).json({ error: 'Une proposition par seconde maximum.' });
  }
  lastGuessAt.set(req.user.id, now);
  next();
}

/* -------------------------------------------------------------- *
 *  Helpers
 * -------------------------------------------------------------- */

function guessRows(userId, date) {
  return db
    .prepare(
      `SELECT word_guessed AS word, score, feedback, attempt_number AS attempt, created_at AS createdAt
       FROM guesses WHERE user_id = ? AND date = ? ORDER BY attempt_number ASC`
    )
    .all(userId, date)
    .map((r) => ({ ...r, tier: feedbackFor(r.score).tier }));
}

function resultRow(userId, date) {
  const row = db.prepare('SELECT * FROM daily_results WHERE user_id = ? AND date = ?').get(userId, date);
  return row ? { ...row } : null;
}

/**
 * Rouvre la partie du jour d'un joueur qui vient de s'abonner.
 *
 * Sans ça, l'abonnement pris depuis la fenêtre « chances épuisées » ne
 * servirait à rien avant le lendemain : on vendrait cinquante chances pour
 * en livrer zéro. Seule une partie perdue faute de chances est concernée —
 * un abandon reste un abandon, une victoire reste acquise.
 */
function reopenIfUpgraded(user, date) {
  if (!user.is_premium) return;
  const result = db
    .prepare("SELECT 1 FROM daily_results WHERE user_id = ? AND date = ? AND outcome = 'exhausted'")
    .get(user.id, date);
  if (!result) return;

  const used = db
    .prepare('SELECT COUNT(*) AS n FROM guesses WHERE user_id = ? AND date = ?')
    .get(user.id, date).n;
  if (used >= attemptsFor(user)) return;

  db.prepare("DELETE FROM daily_results WHERE user_id = ? AND date = ? AND outcome = 'exhausted'").run(
    user.id,
    date
  );
}

function elapsedSeconds(userId, date) {
  const first = db
    .prepare('SELECT created_at FROM guesses WHERE user_id = ? AND date = ? ORDER BY id ASC LIMIT 1')
    .get(userId, date);
  if (!first) return 0;
  const started = new Date(`${first.created_at.replace(' ', 'T')}Z`).getTime();
  return Math.max(0, Math.round((Date.now() - started) / 1000));
}

/* -------------------------------------------------------------- *
 *  GET /api/daily-word — indices + progression du joueur
 * -------------------------------------------------------------- */

gameRouter.get('/daily-word', requireAuth, async (req, res) => {
  const date = todayUtc();
  reopenIfUpgraded(req.user, date);

  const puzzle = publicDailyWord(date);
  const result = resultRow(req.user.id, date);
  const guesses = guessRows(req.user.id, date);
  const finished = Boolean(result);
  const description = finished ? (await describePlayer(getDailyWord(date).word)).text : null;
  const cap = attemptsFor(req.user);

  res.json({
    description,
    puzzle,
    guesses,
    maxAttempts: cap,
    remaining: Math.max(0, cap - guesses.length),
    isPremium: Boolean(req.user.is_premium),
    premiumAttempts: config.game.maxAttemptsPremium,
    solved: Boolean(result && result.outcome === 'found'),
    surrendered: Boolean(result && result.outcome === 'surrendered'),
    result: result
      ? {
          attempts: result.attempts,
          seconds: result.seconds,
          score: result.score,
          outcome: result.outcome,
          surrendered: result.outcome !== 'found',
          word: getDailyWord(date).word, // révélé une fois la partie terminée
        }
      : null,
    engine: claudeEnabled ? 'claude' : 'fallback',
  });
});

/* -------------------------------------------------------------- *
 *  POST /api/guess — proposition d'un mot
 * -------------------------------------------------------------- */

gameRouter.post('/guess', requireAuth, guessLimiter, throttlePerSecond, async (req, res) => {
  const date = todayUtc();
  const check = validateGuess(req.body?.word);
  if (!check.ok) return res.status(400).json({ error: check.error });

  reopenIfUpgraded(req.user, date);
  const cap = attemptsFor(req.user);

  if (resultRow(req.user.id, date)) {
    return res.status(409).json({ error: 'Partie du jour déjà terminée. Reviens demain !' });
  }

  const used = db
    .prepare('SELECT COUNT(*) AS n FROM guesses WHERE user_id = ? AND date = ?')
    .get(req.user.id, date).n;
  if (used >= cap) {
    return res.status(409).json({ error: 'Tu as épuisé tes chances du jour.' });
  }

  const daily = getDailyWord(date);
  const normalized = normalizeWord(check.word);

  const duplicate = db
    .prepare('SELECT word_guessed, score, attempt_number FROM guesses WHERE user_id = ? AND date = ?')
    .all(req.user.id, date)
    .find((g) => normalizeWord(g.word_guessed) === normalized);

  if (duplicate) {
    return res.status(200).json({
      duplicate: true,
      word: duplicate.word_guessed,
      score: duplicate.score,
      ...feedbackFor(duplicate.score),
      attempt: duplicate.attempt_number,
      found: false,
      message: 'Tu as déjà proposé ce mot.',
    });
  }

  // La fiche du joueur du jour lève l'ambiguïté des homonymes.
  // Un seul appel par jour grâce au cache, puis réutilisée à chaque proposition.
  const sheet = await describePlayer(daily.word);
  const identity = sheet.usable ? sheet.text : null;
  const evaluation = await evaluateProximity(check.word, daily.word, 'fr', identity);
  const found = normalized === normalizeWord(daily.word);
  const attempt =
    db.prepare('SELECT COUNT(*) AS n FROM guesses WHERE user_id = ? AND date = ?').get(req.user.id, date).n + 1;

  const fb = found ? { label: 'TROUVÉ !', tier: 'found' } : feedbackFor(evaluation.score);

  db.prepare(
    `INSERT INTO guesses (user_id, date, word_guessed, score, feedback, attempt_number)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(req.user.id, date, check.word, evaluation.score, fb.label, attempt);

  const remaining = Math.max(0, cap - attempt);

  const payload = {
    word: check.word,
    score: evaluation.score,
    label: fb.label,
    tier: fb.tier,
    // Pas d'explication : elle révélerait le poste, la nationalité ou le club.
    attempt,
    remaining,
    maxAttempts: cap,
    found,
    source: evaluation.source,
  };

  // Chances épuisées sans avoir trouvé : la partie du jour est perdue.
  if (!found && remaining === 0) {
    const seconds = elapsedSeconds(req.user.id, date);
    db.prepare(
      `INSERT OR REPLACE INTO daily_results (user_id, date, attempts, seconds, score, surrendered, outcome)
       VALUES (?, ?, ?, ?, 0, 1, 'exhausted')`
    ).run(req.user.id, date, attempt, seconds);

    payload.exhausted = true;
    // Le client n'a pas à deviner s'il faut proposer l'abonnement : c'est le
    // serveur qui connaît le forfait du joueur et la taille de l'offre.
    payload.upsell = req.user.is_premium
      ? null
      : { freeAttempts: cap, premiumAttempts: config.game.maxAttemptsPremium };
    payload.result = {
      attempts: attempt,
      seconds,
      score: 0,
      outcome: 'exhausted',
      surrendered: true,
      word: daily.word,
      puzzleNumber: puzzleNumber(date),
    };
    payload.description = (await describePlayer(daily.word)).text;
    return res.json(payload);
  }

  if (found) {
    const seconds = elapsedSeconds(req.user.id, date);
    const score = soloScore({ attempts: attempt, seconds });

    db.prepare(
      `INSERT OR REPLACE INTO daily_results (user_id, date, attempts, seconds, score, surrendered, outcome)
       VALUES (?, ?, ?, ?, ?, 0, 'found')`
    ).run(req.user.id, date, attempt, seconds, score);

    recordSoloWin(req.user.id, { date, attempts: attempt, seconds, score });
    const unlocked = evaluateSolo(req.user.id, { attempts: attempt, seconds, score });
    const stats = readStats(req.user.id);

    payload.result = {
      attempts: attempt,
      seconds,
      score,
      word: daily.word,
      puzzleNumber: puzzleNumber(date),
    };
    payload.description = (await describePlayer(daily.word)).text;
    payload.unlocked = unlocked;
    payload.stats = stats;
    payload.rank = rankFor(stats);
  }

  res.json(payload);
});

/* -------------------------------------------------------------- *
 *  GET /api/duel/quota — duels restants aujourd'hui
 *
 *  Le refus définitif se joue sur la socket, au moment de lancer la
 *  partie. Cette route existe pour que l'écran de duel puisse le dire
 *  AVANT le clic, plutôt que d'afficher un bouton qui échouera.
 * -------------------------------------------------------------- */

gameRouter.get('/duel/quota', requireAuth, (req, res) => {
  res.json(duelQuota(req.user.id));
});

/* -------------------------------------------------------------- *
 *  POST /api/surrender — abandonner la partie du jour
 * -------------------------------------------------------------- */

gameRouter.post('/surrender', requireAuth, async (req, res) => {
  const date = todayUtc();
  if (resultRow(req.user.id, date)) {
    return res.status(409).json({ error: 'Partie déjà terminée.' });
  }
  const daily = getDailyWord(date);
  const attempts = db
    .prepare('SELECT COUNT(*) AS n FROM guesses WHERE user_id = ? AND date = ?')
    .get(req.user.id, date).n;

  db.prepare(
    `INSERT OR REPLACE INTO daily_results (user_id, date, attempts, seconds, score, surrendered, outcome)
     VALUES (?, ?, ?, ?, 0, 1, 'surrendered')`
  ).run(req.user.id, date, attempts, elapsedSeconds(req.user.id, date));

  res.json({
    surrendered: true,
    outcome: 'surrendered',
    word: daily.word,
    attempts,
    seconds: elapsedSeconds(req.user.id, date),
    score: 0,
    description: (await describePlayer(daily.word)).text,
  });
});

/* -------------------------------------------------------------- *
 *  GET /api/history?date=YYYY-MM-DD
 * -------------------------------------------------------------- */

gameRouter.get('/history', requireAuth, (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : todayUtc();
  res.json({ date, guesses: guessRows(req.user.id, date), result: resultRow(req.user.id, date) });
});

/* Les journées passées vivent dans routes/archive.routes.js : elles sont
   devenues jouables, ce qui en fait un module à part entière. */

/* -------------------------------------------------------------- *
 *  GET /api/me/achievements
 * -------------------------------------------------------------- */

gameRouter.get('/me/achievements', requireAuth, (req, res) => {
  res.json({ achievements: listFor(req.user.id) });
});

/* -------------------------------------------------------------- *
 *  Thèmes de terrain
 * -------------------------------------------------------------- */

gameRouter.get('/themes', (req, res) => {
  res.json({ themes: PITCH_THEMES, default: DEFAULT_THEME });
});

gameRouter.put('/me/theme', requireAuth, (req, res) => {
  const key = String(req.body?.theme || '');
  if (!findTheme(key)) return res.status(400).json({ error: 'Thème inconnu.' });

  if (!canUseTheme(key, req.user.is_premium)) {
    return res.status(402).json({ error: 'Ce thème est réservé au premium.' });
  }

  db.prepare('UPDATE users SET pitch_theme = ? WHERE id = ?').run(key, req.user.id);
  res.json({ theme: key });
});

/* -------------------------------------------------------------- *
 *  GET /api/me/stats/detailed — statistiques détaillées (premium)
 *
 *  Tout est calculé à la volée depuis daily_results : aucune donnée
 *  supplémentaire n'est stockée, le premium ne fait qu'ouvrir la lecture.
 * -------------------------------------------------------------- */

/** Répartition des parties gagnées par nombre de tentatives. */
const ATTEMPT_BUCKETS = [
  { label: '1-3', min: 1, max: 3 },
  { label: '4-6', min: 4, max: 6 },
  { label: '7-10', min: 7, max: 10 },
  { label: '11-20', min: 11, max: 20 },
  { label: '21+', min: 21, max: Infinity },
];

gameRouter.get('/me/stats/detailed', requireAuth, (req, res) => {
  if (!req.user.is_premium) {
    return res.status(402).json({ error: 'Les statistiques détaillées sont réservées au premium.' });
  }

  const rows = db
    .prepare(
      `SELECT date, attempts, seconds, score, outcome
         FROM daily_results WHERE user_id = ? ORDER BY date ASC`
    )
    .all(req.user.id);

  const won = rows.filter((r) => r.outcome === 'found');

  const distribution = ATTEMPT_BUCKETS.map((b) => ({
    label: b.label,
    count: won.filter((r) => r.attempts >= b.min && r.attempts <= b.max).length,
  }));

  const outcomes = {
    found: rows.filter((r) => r.outcome === 'found').length,
    surrendered: rows.filter((r) => r.outcome === 'surrendered').length,
    exhausted: rows.filter((r) => r.outcome === 'exhausted').length,
  };

  // Moyenne par mois : de quoi tracer une courbe de progression lisible.
  const months = new Map();
  for (const r of rows) {
    const key = r.date.slice(0, 7);
    const entry = months.get(key) || { month: key, games: 0, total: 0, wins: 0 };
    entry.games += 1;
    entry.total += r.score;
    if (r.outcome === 'found') entry.wins += 1;
    months.set(key, entry);
  }

  const average = (list, pick) =>
    list.length ? Math.round(list.reduce((sum, r) => sum + pick(r), 0) / list.length) : null;

  res.json({
    // 180 derniers jours : au-delà, le graphique devient illisible.
    history: rows.slice(-180),
    distribution,
    outcomes,
    byMonth: [...months.values()].map((m) => ({
      month: m.month,
      games: m.games,
      averageScore: Math.round(m.total / m.games),
      winRate: Math.round((m.wins / m.games) * 100),
    })),
    totals: {
      games: rows.length,
      winRate: rows.length ? Math.round((outcomes.found / rows.length) * 100) : 0,
      averageAttempts: average(won, (r) => r.attempts),
      averageSeconds: average(won, (r) => r.seconds),
      averageScore: average(rows, (r) => r.score),
      bestScore: rows.length ? Math.max(...rows.map((r) => r.score)) : 0,
    },
  });
});

/*
 * Il n'y a plus de manche de démonstration ouverte à tous.
 *
 * Chaque proposition d'un visiteur anonyme déclenchait un appel facturé à
 * Claude, sans compte à limiter ni partie à terminer : la porte était
 * ouverte à qui voulait consommer le budget quotidien du jeu. Le plaisir de
 * la découverte se paie maintenant au prix d'une inscription gratuite.
 */
