import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { config, attemptsFor } from '../config.js';
import {
  describePlayer,
  evaluateProximity,
  feedbackFor,
  normalizeWord,
  validateGuess,
} from '../claude.js';
import { puzzleNumber, todayUtc } from '../words.js';
import { trainingQuota, trainingStarted } from '../training.js';

export const archiveRouter = Router();

/**
 * Les journées passées.
 *
 * Trois jours d'aperçu gratuit, le reste réservé aux abonnés. Un abonné peut
 * REJOUER une journée qu'il n'a pas faite : la partie se déroule comme en
 * solo, mais dans des tables séparées (archive_guesses / archive_results).
 *
 * Rien de ce qui se passe ici n'alimente le classement, les statistiques ni
 * les médailles : un abonnement ne doit jamais acheter une place au
 * classement. C'est du contenu, pas un avantage.
 *
 * Ce sont les parties d'ENTRAÎNEMENT du forfait premium, et elles sont
 * comptées : quatre par jour, en plus de la partie du jour. Voir
 * training.js — la règle vit là-bas, pas ici.
 */

const FREE_ARCHIVE_DAYS = 3;

/* -------------------------------------------------------------- *
 *  Helpers
 * -------------------------------------------------------------- */

/** Nombre de journées écoulées depuis `date` (0 = hier). */
function daysBack(date) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM daily_words WHERE date < ? AND date >= ?')
    .get(todayUtc(), date).n - 1;
}

/**
 * La journée est-elle CONSULTABLE par ce compte ?
 * Trois jours d'aperçu gratuit, tout l'historique pour les abonnés.
 * Consulter ne coûte rien : les fiches des joueurs sont en cache.
 */
function canAccess(user, date) {
  return Boolean(user.is_premium) || daysBack(date) < FREE_ARCHIVE_DAYS;
}

/**
 * La journée est-elle JOUABLE par ce compte ?
 *
 * Réservé aux abonnés, sans exception. Chaque proposition part vers l'API
 * Claude et coûte quelques centimes : ouvrir le rejeu à tous multiplierait
 * la facture par le nombre de journées archivées, sans contrepartie. La
 * partie du jour, elle, reste gratuite pour tout le monde — c'est le jeu.
 */
function canPlay(user) {
  return Boolean(user.is_premium);
}

function archiveGuesses(userId, date) {
  return db
    .prepare(
      `SELECT word_guessed AS word, score, feedback, attempt_number AS attempt, created_at AS createdAt
         FROM archive_guesses WHERE user_id = ? AND date = ? ORDER BY attempt_number ASC`
    )
    .all(userId, date)
    .map((r) => ({ ...r, tier: feedbackFor(r.score).tier }));
}

function archiveResult(userId, date) {
  const row = db
    .prepare('SELECT * FROM archive_results WHERE user_id = ? AND date = ?')
    .get(userId, date);
  return row ? { ...row } : null;
}

/** A-t-il joué cette journée pour de vrai, le jour même ? */
function playedForReal(userId, date) {
  return Boolean(
    db.prepare('SELECT 1 FROM daily_results WHERE user_id = ? AND date = ?').get(userId, date)
  );
}

/**
 * Le nom peut-il être montré ?
 * Oui s'il connaît déjà la réponse — parce qu'il a joué ce jour-là, ou parce
 * qu'il a terminé son rejeu. Sinon on le cache : sans quoi la journée
 * deviendrait injouable.
 */
function mayReveal(userId, date) {
  return playedForReal(userId, date) || Boolean(archiveResult(userId, date));
}

function elapsedSeconds(userId, date) {
  const first = db
    .prepare(
      'SELECT created_at FROM archive_guesses WHERE user_id = ? AND date = ? ORDER BY id ASC LIMIT 1'
    )
    .get(userId, date);
  if (!first) return 0;
  const started = new Date(`${first.created_at.replace(' ', 'T')}Z`).getTime();
  return Math.max(0, Math.round((Date.now() - started) / 1000));
}

function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < todayUtc();
}

/* -------------------------------------------------------------- *
 *  GET /api/archive — la liste des journées
 * -------------------------------------------------------------- */

archiveRouter.get('/archive', requireAuth, (req, res) => {
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
    .all(req.user.id, todayUtc());

  const days = rows.map((row, i) => {
    const locked = !isPremium && i >= FREE_ARCHIVE_DAYS;
    const played = Boolean(row.outcome);
    const replay = locked ? null : archiveResult(req.user.id, row.date);
    const revealed = !locked && (played || Boolean(replay));

    return {
      date: row.date,
      number: puzzleNumber(row.date),
      locked,
      // Le nom n'est montré que s'il le connaît déjà : sinon la journée
      // resterait à jouer et l'afficher la gâcherait.
      word: revealed ? row.word : null,
      played,
      result: played
        ? { attempts: row.attempts, seconds: row.seconds, score: row.score, outcome: row.outcome }
        : null,
      // Rejouable = abonne ET jamais jouee ce jour-la. Le rejeu appelle
      // l'API a chaque proposition : il reste reserve aux abonnes.
      replayable: isPremium && !played,
      replay: replay
        ? { attempts: replay.attempts, seconds: replay.seconds, outcome: replay.outcome }
        : null,
      inProgress:
        !locked &&
        !replay &&
        archiveGuesses(req.user.id, row.date).length > 0,
    };
  });

  res.json({
    isPremium,
    freeDays: FREE_ARCHIVE_DAYS,
    total: days.length,
    days,
    // Le client doit pouvoir dire « il te reste 2 parties » AVANT le clic,
    // plutôt que d'ouvrir une journée qui refusera la première proposition.
    training: trainingQuota(req.user.id),
  });
});

/* -------------------------------------------------------------- *
 *  GET /api/archive/:date — l'état d'une journée
 * -------------------------------------------------------------- */

archiveRouter.get('/archive/:date', requireAuth, async (req, res) => {
  const date = String(req.params.date || '');
  if (!validDate(date)) return res.status(400).json({ error: 'Date invalide.' });

  const row = db.prepare('SELECT * FROM daily_words WHERE date = ?').get(date);
  if (!row) return res.status(404).json({ error: 'Aucune partie ce jour-là.' });

  if (!canAccess(req.user, date)) {
    return res.status(402).json({ error: 'Cette journée fait partie des archives premium.' });
  }

  const result = archiveResult(req.user.id, date);
  const reveal = mayReveal(req.user.id, date);

  res.json({
    date,
    number: puzzleNumber(date),
    // Indices, comme pour la partie du jour : jamais la réponse.
    length: row.word.length,
    difficulty: row.difficulty,
    category: row.category || null,
    maxAttempts: attemptsFor(req.user),
    // Le client doit savoir s'il peut jouer, pour proposer l'abonnement
    // plutot qu'un champ de saisie qui renverrait une erreur.
    canPlay: canPlay(req.user),
    training: trainingQuota(req.user.id),
    // Une journée déjà entamée ne consomme plus de crédit : le bandeau de
    // quota doit le dire, sinon un joueur à zéro croirait sa partie perdue.
    started: trainingStarted(req.user.id, date),
    guesses: archiveGuesses(req.user.id, date),
    result,
    playedForReal: playedForReal(req.user.id, date),
    word: reveal ? row.word : null,
    description: reveal ? (await describePlayer(row.word)).text : null,
  });
});

/* -------------------------------------------------------------- *
 *  POST /api/archive/:date/guess — proposer, sur une journée passée
 * -------------------------------------------------------------- */

const replayLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.game.guessesPerMinute,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Doucement ! 10 propositions par minute maximum.' },
});

const lastReplayAt = new Map();
function throttlePerSecond(req, res, next) {
  const now = Date.now();
  if (now - (lastReplayAt.get(req.user.id) || 0) < config.game.minGuessIntervalMs) {
    return res.status(429).json({ error: 'Une proposition par seconde maximum.' });
  }
  lastReplayAt.set(req.user.id, now);
  next();
}

archiveRouter.post(
  '/archive/:date/guess',
  requireAuth,
  replayLimiter,
  throttlePerSecond,
  async (req, res) => {
    const date = String(req.params.date || '');
    if (!validDate(date)) return res.status(400).json({ error: 'Date invalide.' });

    const day = db.prepare('SELECT * FROM daily_words WHERE date = ?').get(date);
    if (!day) return res.status(404).json({ error: 'Aucune partie ce jour-là.' });

    if (!canPlay(req.user)) {
      return res
        .status(402)
        .json({ error: 'Rejouer les journées passées est réservé aux abonnés premium.' });
    }
    if (playedForReal(req.user.id, date)) {
      return res.status(409).json({ error: 'Tu as déjà joué cette journée le jour même.' });
    }
    if (archiveResult(req.user.id, date)) {
      return res.status(409).json({ error: 'Tu as déjà rejoué cette journée.' });
    }

    const check = validateGuess(req.body?.word);
    if (!check.ok) return res.status(400).json({ error: check.error });

    const previous = db
      .prepare('SELECT word_guessed, score, attempt_number FROM archive_guesses WHERE user_id = ? AND date = ?')
      .all(req.user.id, date);

    /*
     * Quota d'entraînement — vérifié uniquement à la PREMIÈRE proposition
     * d'une journée. Une partie commencée se termine toujours : couper un
     * joueur au dixième essai parce que minuit est passé serait une
     * punition, pas une limite.
     */
    if (previous.length === 0) {
      const quota = trainingQuota(req.user.id);
      if (quota.remaining <= 0) {
        return res.status(429).json({
          error: `Tu as utilisé tes ${quota.max} parties d'entraînement du jour. La partie du jour, elle, reste ouverte — et tout se remet à zéro à minuit.`,
          quota,
        });
      }
    }

    const cap = attemptsFor(req.user);
    if (previous.length >= cap) {
      return res.status(409).json({ error: 'Chances épuisées sur cette journée.' });
    }

    const normalized = normalizeWord(check.word);
    const duplicate = previous.find((g) => normalizeWord(g.word_guessed) === normalized);
    if (duplicate) {
      return res.json({
        duplicate: true,
        word: duplicate.word_guessed,
        score: duplicate.score,
        ...feedbackFor(duplicate.score),
        attempt: duplicate.attempt_number,
        found: false,
        message: 'Tu as déjà proposé ce mot.',
      });
    }

    const sheet = await describePlayer(day.word);
    const evaluation = await evaluateProximity(
      check.word,
      day.word,
      'fr',
      sheet.usable ? sheet.text : null
    );
    const found = normalized === normalizeWord(day.word);
    const attempt = previous.length + 1;
    const fb = found ? { label: 'TROUVÉ !', tier: 'found' } : feedbackFor(evaluation.score);

    db.prepare(
      `INSERT INTO archive_guesses (user_id, date, word_guessed, score, feedback, attempt_number)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(req.user.id, date, check.word, evaluation.score, fb.label, attempt);

    const remaining = Math.max(0, cap - attempt);

    const payload = {
      word: check.word,
      score: evaluation.score,
      label: fb.label,
      tier: fb.tier,
      attempt,
      remaining,
      maxAttempts: cap,
      found,
      source: evaluation.source,
    };

    // Le crédit vient d'être consommé : on renvoie le compte à jour plutôt
    // que de laisser le client le deviner.
    if (attempt === 1) payload.training = trainingQuota(req.user.id);

    // Fin de partie : trouvé, ou tentatives épuisées.
    if (found || remaining === 0) {
      const seconds = elapsedSeconds(req.user.id, date);
      const outcome = found ? 'found' : 'exhausted';

      db.prepare(
        `INSERT OR REPLACE INTO archive_results (user_id, date, attempts, seconds, outcome)
         VALUES (?, ?, ?, ?, ?)`
      ).run(req.user.id, date, attempt, seconds, outcome);

      // Aucun score, aucune médaille, aucune statistique : le rejeu ne
      // rapporte rien au classement, par construction.
      payload.result = { attempts: attempt, seconds, outcome, word: day.word };
      payload.description = (await describePlayer(day.word)).text;
      if (!found) payload.exhausted = true;
    }

    res.json(payload);
  }
);

/* -------------------------------------------------------------- *
 *  POST /api/archive/:date/surrender — abandonner et voir la réponse
 * -------------------------------------------------------------- */

archiveRouter.post('/archive/:date/surrender', requireAuth, async (req, res) => {
  const date = String(req.params.date || '');
  if (!validDate(date)) return res.status(400).json({ error: 'Date invalide.' });

  const day = db.prepare('SELECT * FROM daily_words WHERE date = ?').get(date);
  if (!day) return res.status(404).json({ error: 'Aucune partie ce jour-là.' });

  if (!canPlay(req.user)) {
    return res
      .status(402)
      .json({ error: 'Rejouer les journées passées est réservé aux abonnés premium.' });
  }
  if (archiveResult(req.user.id, date)) {
    return res.status(409).json({ error: 'Cette journée est déjà terminée.' });
  }

  const attempts = db
    .prepare('SELECT COUNT(*) AS n FROM archive_guesses WHERE user_id = ? AND date = ?')
    .get(req.user.id, date).n;

  /*
   * Abandonner une journée jamais commencée révèle la réponse sans avoir
   * proposé quoi que ce soit — et la fiche du joueur, si elle n'est pas
   * encore en cache, coûte un appel. Ça reste une partie : ça se compte.
   */
  if (attempts === 0) {
    const quota = trainingQuota(req.user.id);
    if (quota.remaining <= 0) {
      return res.status(429).json({
        error: `Tu as utilisé tes ${quota.max} parties d'entraînement du jour. Tout se remet à zéro à minuit.`,
        quota,
      });
    }
  }

  db.prepare(
    `INSERT OR REPLACE INTO archive_results (user_id, date, attempts, seconds, outcome)
     VALUES (?, ?, ?, ?, 'surrendered')`
  ).run(req.user.id, date, attempts, elapsedSeconds(req.user.id, date));

  res.json({
    word: day.word,
    description: (await describePlayer(day.word)).text,
    result: { attempts, outcome: 'surrendered' },
  });
});

/* -------------------------------------------------------------- *
 *  DELETE /api/archive/:date/replay — recommencer une journée
 * -------------------------------------------------------------- */

archiveRouter.delete('/archive/:date/replay', requireAuth, (req, res) => {
  const date = String(req.params.date || '');
  if (!validDate(date)) return res.status(400).json({ error: 'Date invalide.' });

  if (!canPlay(req.user)) {
    return res
      .status(402)
      .json({ error: 'Rejouer les journées passées est réservé aux abonnés premium.' });
  }

  db.prepare('DELETE FROM archive_guesses WHERE user_id = ? AND date = ?').run(req.user.id, date);
  db.prepare('DELETE FROM archive_results WHERE user_id = ? AND date = ?').run(req.user.id, date);

  res.json({ ok: true });
});
