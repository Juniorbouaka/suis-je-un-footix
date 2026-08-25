import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { db } from '../db.js';
import { hasPaidAccess, requireAuth, requirePaidAccess, requirePlayAccess } from '../auth.js';
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
import { creditSummary } from '../credits.js';
import { consumeTrial, trialState } from '../trial.js';

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
 * renoncer — demandent un abonnement OU un essai encore ouvert. Ce sont
 * elles qui appellent l'API Claude, et donc elles qui coûtent.
 *
 * `requirePlayAccess` et non `requirePaidAccess` : le mot du jour est la
 * vitrine, c'est ce qu'il faut avoir joué pour vouloir s'abonner. Huit
 * chances offertes, puis le mur. Les archives et les duels, eux, restent
 * derrière `requirePaidAccess` — ils se paient en crédits.
 *
 * `/daily-word` est gardée au même titre que `/guess` : elle livre les
 * indices de la journée (longueur, difficulté, catégorie), c'est-à-dire le
 * contenu du jour. La laisser ouverte reviendrait à vendre l'entrée d'une
 * salle dont la porte reste entrebâillée.
 */
gameRouter.get('/daily-word', requirePlayAccess, async (req, res) => {
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
    // Le portefeuille voyage avec la partie. Il ne conditionne PAS cette
    // partie-ci — le mot du jour est inclus — mais l'écran affiche le solde
    // en permanence, et il doit pouvoir le faire sans un second aller-retour.
    credits: creditSummary(req.user.id),
    // L'essai, pour que l'écran compte à voix haute. Un compteur qu'on ne
    // voit pas fondre ne donne envie de rien — et celui qui découvre le jeu
    // doit savoir ce qui l'attend au bout, pas le découvrir sur un refus.
    trial: trialState(req.user),
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

gameRouter.post('/guess', requirePlayAccess, guessLimiter, throttlePerSecond, async (req, res) => {
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
   * Aucun péage ici, et c'est délibéré.
   *
   * Le joueur mystère du jour est INCLUS dans l'abonnement : une partie par
   * jour, tous les jours, sans rien décompter. C'est le rendez-vous du jeu
   * et la raison pour laquelle on ouvre le site le matin — mettre un
   * compteur devant, c'est faire hésiter quelqu'un avant de faire la seule
   * chose qu'on veut le voir faire.
   *
   * Ce qui se paie en crédits, ce sont les parties EN PLUS : rejouer une
   * journée d'archive (archive.routes.js), lancer un duel (realtime.js).
   * L'abonnement a déjà été vérifié en amont par `requirePaidAccess` — la
   * porte est passée, la partie du jour est comprise dedans.
   */
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
     * Rien à rembourser : la partie du jour n'a rien coûté. Aucune chance
     * n'est consommée non plus — le joueur retrouve sa partie intacte et
     * réessaie quand l'évaluateur répond de nouveau.
     */
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

  /*
   * L'essai se décompte ICI, et pas plus haut.
   *
   * Une proposition que l'évaluateur a refusé de noter (plafond de dépense,
   * panne) rend la main plus haut sans rien enregistrer : elle n'a rien
   * montré au visiteur, elle n'a donc pas à lui coûter une de ses huit
   * chances. Même principe que le non-débit des crédits sur panne — on ne
   * facture pas un service qu'on n'a pas rendu, fût-il gratuit.
   *
   * Un compte payant ne consomme rien : il lit son état sans y toucher.
   * Sans ce test, un abonné verrait son essai fondre pour rien et le
   * retrouverait vide le jour où il résilierait.
   */
  const essai = hasPaidAccess(req.user) ? trialState(req.user) : consumeTrial(req.user.id);

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
    // L'essai après cette proposition : le compteur descend sous les yeux
    // du joueur plutôt que de le cueillir par un refus à la huitième.
    trial: essai,
    /*
     * Le mur, annoncé dans la réponse qui le déclenche.
     *
     * Le client pourrait le déduire de `trial.remaining === 0`, mais un
     * drapeau nommé se lit d'un coup d'œil et ne se recalcule pas de trois
     * façons dans trois écrans. La partie du jour n'est PAS refermée pour
     * autant : aucune ligne n'est écrite dans `daily_results`, le joueur
     * qui s'abonne reprend cette partie-ci là où il l'a laissée, avec ses
     * vingt chances. C'est le meilleur argument de vente qu'on ait — « tu y
     * étais presque » vaut mieux que « reviens demain ».
     */
    trialExhausted: essai.exhausted,
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
     * Ce qu'on propose à la fin d'une partie perdue.
     *
     * On ne vend plus de chances — vingt pour tout le monde — ni la partie
     * du jour, qui est comprise dans l'abonnement. Ce qu'on peut offrir,
     * c'est de RECOMMENCER ailleurs tout de suite : une journée d'archive,
     * contre une partie du stock. Le client décide quoi en faire selon ce
     * qui reste au portefeuille — et s'il est vide, il proposera une
     * recharge plutôt que de renvoyer à demain.
     */
    payload.upsell = {
      canReplay: creditSummary(req.user.id).balance >= config.credits.costArchive,
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

gameRouter.post('/surrender', requirePlayAccess, async (req, res) => {
  const date = todayUtc();
  if (resultRow(req.user.id, date)) {
    return res.status(409).json({ error: 'Partie déjà terminée.' });
  }
  const daily = getDailyWord(date);
  const attempts = db
    .prepare('SELECT COUNT(*) AS n FROM guesses WHERE user_id = ? AND date = ?')
    .get(req.user.id, date).n;

  /*
   * Renoncer ne coûte rien non plus : c'est la même partie du jour, incluse
   * dans l'abonnement, et elle est de toute façon terminée pour aujourd'hui.
   *
   * Le contournement qu'on redoutait — ouvrir, abandonner, lire la réponse
   * sans jamais payer — n'en est plus un : il n'y avait rien à contourner.
   * La seule limite qui tienne ici est celle d'UNE partie du jour par jour,
   * et elle est portée par `daily_results`, pas par le portefeuille.
   */
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
