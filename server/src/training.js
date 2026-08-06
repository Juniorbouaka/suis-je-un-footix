import { db } from './db.js';
import { config, trainingPerDay } from './config.js';
import { isAdmin } from './auth.js';

/**
 * Le quota de parties d'entraînement.
 *
 * Une partie d'entraînement, c'est une journée d'archive rejouée : même
 * déroulé qu'en solo, mais rien n'est compté — ni point, ni médaille, ni
 * place au classement. C'est ce qui permet d'en vendre cinq par jour sans
 * abîmer le classement : l'abonnement achète du temps de jeu, jamais des
 * points.
 *
 * Le compte se lit dans `archive_guesses`, sans table supplémentaire : une
 * journée compte pour une partie du jour si sa PREMIÈRE proposition a été
 * envoyée aujourd'hui. Deux conséquences voulues :
 *
 *   — une partie commencée hier et terminée ce matin ne consomme rien
 *     aujourd'hui : on ne fait pas payer deux fois la même partie ;
 *   — ouvrir une journée sans rien proposer ne consomme rien non plus.
 *     Regarder ne coûte aucun appel à l'IA, seul proposer en coûte.
 *
 * Le droit premium est relu en base à chaque appel plutôt que pris sur le
 * jeton : un joueur qui s'abonne pendant sa session en profite tout de
 * suite, sans se reconnecter. Même règle que pour les duels.
 */

/** La partie du jour, celle qui compte au classement. Toujours offerte. */
const PARTIES_CLASSEES = 1;

export function trainingQuota(userId) {
  // L'e-mail est lu pour le droit d'administration, qui vaut premium (voir
  // findUserById) : le quota ne doit pas contredire le reste du jeu.
  const row = db.prepare('SELECT is_premium, email FROM users WHERE id = ?').get(userId);
  const premium = Boolean(row?.is_premium) || isAdmin(row);

  const max = trainingPerDay({ is_premium: premium });

  /*
   * Une journée compte pour une partie si elle a été OUVERTE aujourd'hui.
   * Deux façons de l'ouvrir, d'où l'union :
   *
   *   — proposer un premier mot (le cas normal) ;
   *   — abandonner tout de suite pour voir la réponse. Sans cette seconde
   *     branche, il suffirait d'abandonner chaque journée sans rien
   *     proposer pour lire tout le catalogue sans jamais rien consommer.
   *
   * La seconde branche ignore les journées qui ont des propositions : la
   * première les compte déjà, et une partie ne se paie qu'une fois.
   */
  const played = db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT date, MIN(created_at) AS ouverte_a
           FROM archive_guesses
          WHERE user_id = ?
          GROUP BY date
          UNION ALL
         SELECT r.date, r.created_at
           FROM archive_results r
          WHERE r.user_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM archive_guesses g
               WHERE g.user_id = r.user_id AND g.date = r.date
            )
       )
       WHERE date(ouverte_a) = date('now')`
    )
    .get(userId, userId).n;

  return {
    isPremium: premium,
    max,
    played,
    remaining: Math.max(0, max - played),
    // De quoi écrire « 5 parties par jour » côté client sans recopier la
    // règle : une partie classée + les parties d'entraînement.
    ranked: PARTIES_CLASSEES,
    gamesPerDay: config.game.gamesPerDayPremium,
    premiumMax: Math.max(0, config.game.gamesPerDayPremium - PARTIES_CLASSEES),
  };
}

/**
 * Cette journée est-elle DÉJÀ commencée ?
 *
 * Une partie en cours ne consomme pas un second crédit : le quota se paie
 * à l'ouverture, pas à chaque proposition.
 */
export function trainingStarted(userId, date) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM archive_guesses WHERE user_id = ? AND date = ?
          UNION ALL
         SELECT 1 FROM archive_results WHERE user_id = ? AND date = ?
         LIMIT 1`
      )
      .get(userId, date, userId, date)
  );
}
