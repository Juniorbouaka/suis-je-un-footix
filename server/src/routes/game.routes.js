import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
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
  const puzzle = publicDailyWord(date);
  const result = resultRow(req.user.id, date);
  const guesses = guessRows(req.user.id, date);
  const finished = Boolean(result);
  const description = finished ? (await describePlayer(getDailyWord(date).word)).text : null;

  res.json({
    description,
    puzzle,
    guesses,
    maxAttempts: config.game.maxAttempts,
    remaining: Math.max(0, config.game.maxAttempts - guesses.length),
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

  if (resultRow(req.user.id, date)) {
    return res.status(409).json({ error: 'Partie du jour déjà terminée. Reviens demain !' });
  }

  const used = db
    .prepare('SELECT COUNT(*) AS n FROM guesses WHERE user_id = ? AND date = ?')
    .get(req.user.id, date).n;
  if (used >= config.game.maxAttempts) {
    return res.status(409).json({ error: 'Tu as épuisé tes tentatives du jour.' });
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

  const remaining = Math.max(0, config.game.maxAttempts - attempt);

  const payload = {
    word: check.word,
    score: evaluation.score,
    label: fb.label,
    tier: fb.tier,
    // Pas d'explication : elle révélerait le poste, la nationalité ou le club.
    attempt,
    remaining,
    maxAttempts: config.game.maxAttempts,
    found,
    source: evaluation.source,
  };

  // Tentatives épuisées sans avoir trouvé : la partie du jour est perdue.
  if (!found && remaining === 0) {
    const seconds = elapsedSeconds(req.user.id, date);
    db.prepare(
      `INSERT OR REPLACE INTO daily_results (user_id, date, attempts, seconds, score, surrendered, outcome)
       VALUES (?, ?, ?, ?, 0, 1, 'exhausted')`
    ).run(req.user.id, date, attempt, seconds);

    payload.exhausted = true;
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

/* -------------------------------------------------------------- *
 *  GET /api/archive — les joueurs des jours précédents
 *  Aperçu gratuit sur les 3 derniers jours, historique complet en premium.
 * -------------------------------------------------------------- */

const FREE_ARCHIVE_DAYS = 3;

gameRouter.get('/archive', requireAuth, (req, res) => {
  const today = todayUtc();
  const isPremium = Boolean(req.user.is_premium);

  const rows = db
    .prepare(
      `SELECT w.date, w.word, r.attempts, r.seconds, r.score, r.outcome
       FROM daily_words w
       LEFT JOIN daily_results r ON r.date = w.date AND r.user_id = ?
       WHERE w.date < ?
       ORDER BY w.date DESC
       LIMIT 400`
    )
    .all(req.user.id, today);

  const days = rows.map((row, i) => {
    const locked = !isPremium && i >= FREE_ARCHIVE_DAYS;
    return {
      date: row.date,
      number: puzzleNumber(row.date),
      locked,
      // Le nom n'est révélé que si la journée est accessible.
      word: locked ? null : row.word,
      played: Boolean(row.outcome),
      result: row.outcome
        ? { attempts: row.attempts, seconds: row.seconds, score: row.score, outcome: row.outcome }
        : null,
    };
  });

  res.json({
    isPremium,
    freeDays: FREE_ARCHIVE_DAYS,
    total: days.length,
    days,
  });
});

/* -------------------------------------------------------------- *
 *  GET /api/archive/:date — la fiche d'une journée passée (premium)
 * -------------------------------------------------------------- */

gameRouter.get('/archive/:date', requireAuth, async (req, res) => {
  const date = String(req.params.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= todayUtc()) {
    return res.status(400).json({ error: 'Date invalide.' });
  }

  const row = db.prepare('SELECT word FROM daily_words WHERE date = ?').get(date);
  if (!row) return res.status(404).json({ error: 'Aucune partie ce jour-là.' });

  const recent = db
    .prepare('SELECT COUNT(*) AS n FROM daily_words WHERE date < ? AND date >= ?')
    .get(todayUtc(), date).n;

  if (!req.user.is_premium && recent > FREE_ARCHIVE_DAYS) {
    return res.status(402).json({ error: 'Cette journée fait partie des archives premium.' });
  }

  res.json({
    date,
    number: puzzleNumber(date),
    word: row.word,
    description: (await describePlayer(row.word)).text,
    guesses: guessRows(req.user.id, date),
  });
});

/* -------------------------------------------------------------- *
 *  GET /api/me/achievements
 * -------------------------------------------------------------- */

gameRouter.get('/me/achievements', requireAuth, (req, res) => {
  res.json({ achievements: listFor(req.user.id) });
});

/* -------------------------------------------------------------- *
 *  POST /api/demo/guess — tutoriel, sans compte
 * -------------------------------------------------------------- */

const DEMO_WORD = 'zidane';
const demoLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });

gameRouter.post('/demo/guess', demoLimiter, async (req, res) => {
  const check = validateGuess(req.body?.word);
  if (!check.ok) return res.status(400).json({ error: check.error });

  const evaluation = await evaluateProximity(check.word, DEMO_WORD, 'fr');
  const found = normalizeWord(check.word) === DEMO_WORD;
  const fb = found ? { label: 'TROUVÉ !', tier: 'found' } : feedbackFor(evaluation.score);

  res.json({
    word: check.word,
    score: evaluation.score,
    label: fb.label,
    tier: fb.tier,
    found,
    description: found ? (await describePlayer(DEMO_WORD)).text : null,
  });
});
