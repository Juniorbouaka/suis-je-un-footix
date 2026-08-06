import { db } from './db.js';
import { todayUtc } from './words.js';

/**
 * Le palmarès mensuel.
 *
 * Chaque mois écoulé est « scellé » : son vainqueur est écrit une fois pour
 * toutes dans `monthly_champions`. Le scellage est paresseux — il se fait à
 * la première consultation du classement après la fin du mois, comme
 * l'expiration du premium. Aucune tâche planifiée à maintenir, donc rien qui
 * puisse silencieusement ne plus tourner.
 *
 * Le mois en cours n'est jamais scellé : tant qu'il reste une journée à
 * jouer, le classement du mois peut changer.
 */

/** Mois courant, en UTC comme le joueur du jour. */
export function currentMonth() {
  return todayUtc().slice(0, 7);
}

/** Le classement d'un mois : total des points des parties gagnées. */
export function monthlyRanking(month, limit = 100) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.is_premium,
              SUM(r.score) AS total, COUNT(*) AS days,
              MIN(r.attempts) AS attempts, MIN(r.seconds) AS seconds
         FROM daily_results r JOIN users u ON u.id = r.user_id
        WHERE r.outcome = 'found' AND substr(r.date, 1, 7) = ?
        GROUP BY u.id
        ORDER BY total DESC, days DESC, seconds ASC
        LIMIT ?`
    )
    .all(month, limit);
}

/**
 * Scelle tous les mois terminés qui ne le sont pas encore.
 *
 * Le jeu peut très bien avoir dormi plusieurs mois : on ne suppose pas qu'il
 * n'y a qu'un seul mois en retard.
 */
export function sealFinishedMonths() {
  const months = db
    .prepare(
      `SELECT DISTINCT substr(r.date, 1, 7) AS month
         FROM daily_results r
        WHERE r.outcome = 'found' AND substr(r.date, 1, 7) < ?
          AND NOT EXISTS (SELECT 1 FROM monthly_champions c WHERE c.month = substr(r.date, 1, 7))
        ORDER BY month ASC`
    )
    .all(currentMonth());

  for (const { month } of months) {
    const winner = monthlyRanking(month, 1)[0];
    if (!winner) continue;
    db.prepare(
      'INSERT OR IGNORE INTO monthly_champions (month, user_id, username, total, days) VALUES (?, ?, ?, ?, ?)'
    ).run(month, winner.id, winner.username, winner.total, winner.days);
  }

  return months.length;
}

/** Le palmarès, du mois le plus récent au plus ancien. */
export function pastChampions(limit = 60) {
  sealFinishedMonths();
  return db
    .prepare(
      `SELECT c.month, c.user_id, c.username, c.total, c.days, c.sealed_at,
              u.is_premium
         FROM monthly_champions c
         LEFT JOIN users u ON u.id = c.user_id
        ORDER BY c.month DESC
        LIMIT ?`
    )
    .all(limit);
}
