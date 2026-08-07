import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { db } from '../db.js';
import { requireAuth, requirePaidAccess } from '../auth.js';
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
import { alreadyPaid, creditSummary, refund, spendOnce } from '../credits.js';

/** Référence du débit d'une partie du jour. Une par joueur et par journée. */
const refSolo = (date) => `solo:${date}`;

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

/*
 * Les trois routes qui font jouer — lire la partie du jour, proposer,
 * abandonner — exigent un abonnement. Ce sont elles qui appellent l'API
 * Claude, et donc elles qui coûtent.
 *
 * `/daily-word` est gardée au même titre que `/guess` : elle livre les
 * indices de la journée (longueur, difficulté, catégorie), c'est-à-dire le
 * contenu du jour. La laisser ouverte reviendrait à vendre l'entrée d'une
 * salle dont la porte reste entrebâillée.
 */
gameRouter.get('/daily-word', requirePaidAccess, async (req, res) => {
  const date = todayUtc();

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
    // Le portefeuille voyage avec la partie : l'écran doit pouvoir dire « il
    // te reste 12 parties » sans un second aller-retour, et surtout annoncer
    // le prix AVANT la première proposition.
    credits: creditSummary(req.user.id),
    // Une partie déjà entamée ne sera pas redébitée : le bandeau doit le
    // dire, sinon un joueur à zéro crédit croirait sa partie perdue.
    paid: alreadyPaid(req.user.id, refSolo(date)),
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

gameRouter.post('/guess', requirePaidAccess, guessLimiter, throttlePerSecond, async (req, res) => {
  const date = todayUtc();
  const check = validateGuess(req.body?.word);
  if (!check.ok) return res.status(400).json({ error: check.error });

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

  /*
   * Le péage.
   *
   * Il est franchi ici, à la première proposition, et non à l'ouverture de
   * l'écran : regarder la grille du jour ne coûte rien à servir, alors elle
   * ne coûte rien à consulter. C'est proposer qui appelle l'API et qui se
   * paie.
   *
   * `spendOnce` porte la référence de la journée : les quatorze propositions
   * suivantes retrouvent le débit déjà passé et ne prélèvent rien. Une partie
   * se paie une fois, même si on la reprend le lendemain matin après une
   * déconnexion.
   *
   * Le débit précède volontairement l'appel à Claude. L'ordre inverse —
   * évaluer puis facturer — laisserait deux onglets ouverts en même temps
   * dépenser deux fois le dernier crédit, et nous aurions payé les deux
   * appels. Ce qui suit se charge de rendre le crédit si l'évaluation
   * n'aboutit pas.
   */
  const ref = refSolo(date);
  const premiereProposition = !alreadyPaid(req.user.id, ref);
  const paiement = spendOnce(req.user.id, config.credits.costSolo, 'solo', ref);

  if (!paiement.ok) {
    return res.status(402).json({
      error:
        'Plus de crédits. Ton stock se recharge à ta prochaine échéance — ou passe à l’Illimité pour en avoir davantage.',
      needsCredits: true,
      credits: creditSummary(req.user.id),
    });
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

  /*
   * L'évaluateur peut refuser de répondre (plafond de dépense, panne). On rend
   * la main SANS rien enregistrer : pas de proposition en base, donc pas de
   * chance consommée et rien qui parte au classement. Le joueur retrouve sa
   * partie intacte. Inventer un score serait pire que ce refus.
   */
  let evaluation;
  try {
    evaluation = await evaluateProximity(check.word, daily.word, 'fr', identity);
  } catch (err) {
    if (err.name !== 'EvaluateurIndisponible') throw err;

    /*
     * La panne tombe sur la PREMIÈRE proposition : la partie n'a pas
     * commencé, donc elle n'est pas due. Le remboursement annule le débit —
     * la référence retombe à zéro, et la journée redevient payante au
     * prochain essai (voir alreadyPaid, qui lit le solde et non les lignes).
     *
     * Aux propositions suivantes il n'y a rien à rendre : la partie a bien
     * eu lieu, c'est cette tentative-là qui n'a pas abouti, et elle n'a
     * consommé aucune chance.
     */
    if (premiereProposition) {
      refund(req.user.id, paiement.cost, 'remboursement-evaluateur', ref);
    }

    return res.status(503).json({ error: err.message, retryable: true });
  }
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
    /*
     * Ce qu'on propose à la fin d'une partie perdue a changé de nature.
     *
     * Avant, on vendait des chances : « quinze aujourd'hui, cinquante avec
     * l'abonnement ». Ce n'est plus vrai — quinze pour tout le monde. Ce
     * qu'on peut offrir maintenant, c'est de RECOMMENCER ailleurs : une
     * journée d'archive, tout de suite, contre un crédit. Le client décide
     * quoi en faire selon ce qui reste au portefeuille.
     */
    payload.upsell = {
      canReplay: creditSummary(req.user.id).balance >= config.credits.costSolo,
      plan: req.user.subscription_plan || null,
    };
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
    payload.credits = creditSummary(req.user.id);
    return res.json(payload);
  }

  if (found) {
    const seconds = elapsedSeconds(req.user.id, date);
    const score = soloScore({ attempts: attempt, seconds });

    db.prepare(
      `INSERT OR REPLACE INTO daily_results (user_id, date, attempts, seconds, score, surrendered, outcome)
       VALUES (?, ?, ?, ?, ?, 0, 'found')`
    ).run(req.user.id, date, attempt, seconds, score);

    const { ranked } = recordSoloWin(req.user.id, { date, attempts: attempt, seconds, score });

    /*
     * Hors classement : aucune médaille non plus.
     *
     * Les deux vont ensemble. Une médaille est une distinction, et distinguer
     * une partie qui ne compte pas serait exactement le contournement qu'on
     * vient de fermer côté score — il suffirait de rejouer jusqu'à décrocher
     * la bonne série.
     */
    const unlocked = ranked
      ? evaluateSolo(req.user.id, { attempts: attempt, seconds, score })
      : [];
    const stats = readStats(req.user.id);

    payload.result = {
      attempts: attempt,
      seconds,
      // Le score reste affiché même hors classement : le joueur a le droit
      // de savoir comment il a joué. C'est le tableau qui l'ignore, pas lui.
      score,
      ranked,
      word: daily.word,
      puzzleNumber: puzzleNumber(date),
    };
    payload.ranked = ranked;
    payload.description = (await describePlayer(daily.word)).text;
    payload.unlocked = unlocked;
    payload.stats = stats;
    payload.rank = rankFor(stats);
    payload.credits = creditSummary(req.user.id);
  }

  res.json(payload);
});

/* -------------------------------------------------------------- *
 *  GET /api/duel/quota — ce qu'un duel va coûter, et ce qui reste
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

gameRouter.post('/surrender', requirePaidAccess, async (req, res) => {
  const date = todayUtc();
  if (resultRow(req.user.id, date)) {
    return res.status(409).json({ error: 'Partie déjà terminée.' });
  }
  const daily = getDailyWord(date);
  const attempts = db
    .prepare('SELECT COUNT(*) AS n FROM guesses WHERE user_id = ? AND date = ?')
    .get(req.user.id, date).n;

  /*
   * Abandonner sans avoir rien proposé révèle quand même la réponse et la
   * fiche du joueur — qui coûte un appel si elle n'est pas encore en cache.
   * C'est une partie consommée, elle se paie comme les autres.
   *
   * Sans ce débit, la porte de sortie devenait la porte d'entrée : ouvrir,
   * abandonner, lire la réponse, recommencer demain, sans jamais dépenser un
   * crédit. `spendOnce` reconnaît la partie déjà payée si le joueur avait
   * proposé quelque chose avant de renoncer — on ne facture pas deux fois.
   */
  const paiement = spendOnce(req.user.id, config.credits.costSolo, 'solo', refSolo(date));
  if (!paiement.ok) {
    return res.status(402).json({
      error: 'Plus de crédits — même pour voir la réponse. Ton stock se recharge à ta prochaine échéance.',
      needsCredits: true,
      credits: creditSummary(req.user.id),
    });
  }

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
    credits: creditSummary(req.user.id),
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
