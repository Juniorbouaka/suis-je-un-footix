import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { db } from '../db.js';
import { requirePaidAccess } from '../auth.js';
import { config, attemptsFor } from '../config.js';
import {
  describePlayer,
  evaluateProximity,
  feedbackFor,
  normalizeWord,
  validateGuess,
} from '../claude.js';
import { puzzleNumber, todayUtc } from '../words.js';
import { alreadyPaid, creditSummary, refund, spend, spendOnce } from '../credits.js';

/** Référence du débit d'une journée rejouée. Une par joueur et par journée. */
const refArchive = (date) => `archive:${date}`;

export const archiveRouter = Router();

/**
 * Les journées passées.
 *
 * Tout ce module exige un abonnement — même consulter la liste. Au-delà, il
 * n'y a plus de niveaux : tout abonné voit tout l'historique et peut
 * REJOUER n'importe quelle journée qu'il n'a pas faite, contre un crédit.
 * La partie se déroule alors comme en solo, mais dans des tables séparées
 * (archive_guesses / archive_results).
 *
 * Les trois jours d'aperçu et le quota de parties d'entraînement ont disparu
 * ensemble : c'était deux façons de rationner ce que le portefeuille rationne
 * maintenant, mieux et plus simplement. Consulter ne coûte rien à servir —
 * les fiches sont en cache — donc consulter ne coûte rien. Proposer appelle
 * l'API, donc proposer coûte un crédit. La règle tient en une phrase.
 *
 * Rien de ce qui se passe ici n'alimente le classement, les statistiques ni
 * les médailles : un abonnement ne doit jamais acheter une place au
 * classement. C'est du contenu, pas un avantage.
 */

/* -------------------------------------------------------------- *
 *  Helpers
 * -------------------------------------------------------------- */

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

archiveRouter.get('/archive', requirePaidAccess, (req, res) => {
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

  const days = rows.map((row) => {
    const played = Boolean(row.outcome);
    const replay = archiveResult(req.user.id, row.date);

    return {
      date: row.date,
      number: puzzleNumber(row.date),
      // Plus rien n'est verrouillé : tout abonné voit tout l'historique. Le
      // champ reste dans la réponse le temps que les écrans s'en détachent —
      // le retirer d'un coup ferait disparaître des journées côté client.
      locked: false,
      // Le nom n'est montré que s'il le connaît déjà : sinon la journée
      // resterait à jouer et l'afficher la gâcherait.
      word: played || replay ? row.word : null,
      played,
      result: played
        ? { attempts: row.attempts, seconds: row.seconds, score: row.score, outcome: row.outcome }
        : null,
      // Rejouable = jamais jouée ce jour-là. Ce n'est plus une question de
      // forfait mais de portefeuille, et le portefeuille est annoncé à part.
      replayable: !played,
      // Cette journée est-elle déjà payée ? Une partie entamée puis
      // interrompue ne se repaie pas, et l'écran doit pouvoir le dire.
      paid: alreadyPaid(req.user.id, row.date ? refArchive(row.date) : ''),
      replay: replay
        ? { attempts: replay.attempts, seconds: replay.seconds, outcome: replay.outcome }
        : null,
      inProgress: !replay && archiveGuesses(req.user.id, row.date).length > 0,
    };
  });

  res.json({
    isPremium,
    total: days.length,
    days,
    // Le client doit pouvoir dire « il te reste 12 parties » AVANT le clic,
    // plutôt que d'ouvrir une journée qui refusera la première proposition.
    credits: creditSummary(req.user.id),
  });
});

/* -------------------------------------------------------------- *
 *  GET /api/archive/:date — l'état d'une journée
 * -------------------------------------------------------------- */

archiveRouter.get('/archive/:date', requirePaidAccess, async (req, res) => {
  const date = String(req.params.date || '');
  if (!validDate(date)) return res.status(400).json({ error: 'Date invalide.' });

  const row = db.prepare('SELECT * FROM daily_words WHERE date = ?').get(date);
  if (!row) return res.status(404).json({ error: 'Aucune partie ce jour-là.' });

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
    // Le client doit savoir s'il peut jouer, pour proposer la recharge
    // plutôt qu'un champ de saisie qui renverrait une erreur. Une journée
    // déjà entamée reste jouable même à zéro crédit : elle est payée.
    canPlay:
      alreadyPaid(req.user.id, refArchive(date)) ||
      creditSummary(req.user.id).balance >= config.credits.costSolo,
    credits: creditSummary(req.user.id),
    // Une journée déjà entamée ne consomme plus de crédit : le bandeau doit
    // le dire, sinon un joueur à zéro croirait sa partie perdue.
    paid: alreadyPaid(req.user.id, refArchive(date)),
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
  requirePaidAccess,
  replayLimiter,
  throttlePerSecond,
  async (req, res) => {
    const date = String(req.params.date || '');
    if (!validDate(date)) return res.status(400).json({ error: 'Date invalide.' });

    const day = db.prepare('SELECT * FROM daily_words WHERE date = ?').get(date);
    if (!day) return res.status(404).json({ error: 'Aucune partie ce jour-là.' });

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
     * Le péage, exactement comme en solo : un crédit par journée rejouée,
     * prélevé à la première proposition et à elle seule. Une partie
     * commencée se termine toujours, même si le portefeuille s'est vidé
     * entre-temps — couper un joueur au dixième essai d'une partie qu'il a
     * payée serait une punition, pas une limite.
     */
    const ref = refArchive(date);
    const premiereProposition = !alreadyPaid(req.user.id, ref);
    const paiement = spendOnce(req.user.id, config.credits.costSolo, 'archive', ref);

    if (!paiement.ok) {
      return res.status(402).json({
        error:
          'Plus de crédits. Ton stock se recharge à ta prochaine échéance — ou passe à l’Illimité pour en avoir davantage.',
        needsCredits: true,
        credits: creditSummary(req.user.id),
      });
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

    // Même règle qu'en solo : on refuse plutôt que d'inventer un score. Rien
    // n'est enregistré, et si la panne tombe sur la première proposition, le
    // crédit est rendu — la partie n'a pas eu lieu, elle n'est pas due.
    let evaluation;
    try {
      evaluation = await evaluateProximity(
        check.word,
        day.word,
        'fr',
        sheet.usable ? sheet.text : null
      );
    } catch (err) {
      if (err.name !== 'EvaluateurIndisponible') throw err;
      if (premiereProposition) {
        refund(req.user.id, paiement.cost, 'remboursement-evaluateur', ref);
      }
      return res.status(503).json({ error: err.message, retryable: true });
    }
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

    // Le crédit vient d'être consommé : on renvoie le solde à jour plutôt
    // que de laisser le client le deviner.
    if (attempt === 1) payload.credits = creditSummary(req.user.id);

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

archiveRouter.post('/archive/:date/surrender', requirePaidAccess, async (req, res) => {
  const date = String(req.params.date || '');
  if (!validDate(date)) return res.status(400).json({ error: 'Date invalide.' });

  const day = db.prepare('SELECT * FROM daily_words WHERE date = ?').get(date);
  if (!day) return res.status(404).json({ error: 'Aucune partie ce jour-là.' });

  if (archiveResult(req.user.id, date)) {
    return res.status(409).json({ error: 'Cette journée est déjà terminée.' });
  }

  const attempts = db
    .prepare('SELECT COUNT(*) AS n FROM archive_guesses WHERE user_id = ? AND date = ?')
    .get(req.user.id, date).n;

  /*
   * Abandonner une journée jamais commencée révèle la réponse sans avoir
   * proposé quoi que ce soit — et la fiche du joueur, si elle n'est pas
   * encore en cache, coûte un appel. Ça reste une partie : ça se paie.
   *
   * `spendOnce` ne prélève rien si la journée a déjà été payée par une
   * première proposition : renoncer en cours de route ne coûte pas un
   * second crédit.
   */
  const paiement = spendOnce(req.user.id, config.credits.costSolo, 'archive', refArchive(date));
  if (!paiement.ok) {
    return res.status(402).json({
      error: 'Plus de crédits — même pour voir la réponse. Ton stock se recharge à ta prochaine échéance.',
      needsCredits: true,
      credits: creditSummary(req.user.id),
    });
  }

  db.prepare(
    `INSERT OR REPLACE INTO archive_results (user_id, date, attempts, seconds, outcome)
     VALUES (?, ?, ?, ?, 'surrendered')`
  ).run(req.user.id, date, attempts, elapsedSeconds(req.user.id, date));

  res.json({
    word: day.word,
    description: (await describePlayer(day.word)).text,
    result: { attempts, outcome: 'surrendered' },
    credits: creditSummary(req.user.id),
  });
});

/* -------------------------------------------------------------- *
 *  DELETE /api/archive/:date/replay — recommencer une journée
 * -------------------------------------------------------------- */

/*
 * Recommencer coûte un crédit, et il est prélevé ICI, tout de suite.
 *
 * C'est la faille que cette route ouvrirait sinon, et elle est béante :
 * une journée déjà payée le reste (`alreadyPaid` lit la référence, pas les
 * propositions). Effacer ses propositions puis rejouer aurait donc rendu la
 * journée gratuite — indéfiniment. Un joueur aurait pu vivre toute l'année
 * sur un seul crédit en recommençant la même journée.
 *
 * Le débit est donc immédiat et distinct : la première proposition qui
 * suivra retrouvera la journée payée et ne prélèvera rien de plus. Une
 * partie recommencée est une partie de plus, elle se paie comme telle.
 */
archiveRouter.delete('/archive/:date/replay', requirePaidAccess, (req, res) => {
  const date = String(req.params.date || '');
  if (!validDate(date)) return res.status(400).json({ error: 'Date invalide.' });

  // Rien à recommencer : ni propositions, ni résultat. On ne facture pas
  // l'effacement de ce qui n'existe pas.
  const entamee =
    archiveGuesses(req.user.id, date).length > 0 || Boolean(archiveResult(req.user.id, date));

  if (entamee) {
    const paiement = spend(req.user.id, config.credits.costSolo, 'archive-recommence', refArchive(date));
    if (!paiement.ok) {
      return res.status(402).json({
        error: 'Recommencer cette journée coûte un crédit, et il ne t’en reste plus.',
        needsCredits: true,
        credits: creditSummary(req.user.id),
      });
    }
  }

  db.prepare('DELETE FROM archive_guesses WHERE user_id = ? AND date = ?').run(req.user.id, date);
  db.prepare('DELETE FROM archive_results WHERE user_id = ? AND date = ?').run(req.user.id, date);

  res.json({ ok: true, credits: creditSummary(req.user.id) });
});
