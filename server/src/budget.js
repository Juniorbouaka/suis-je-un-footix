import { db } from './db.js';
import { config } from './config.js';

/**
 * Plafond de dépense quotidien.
 * Chaque appel facturé à Claude est compté ; une fois le plafond atteint,
 * le jeu continue de tourner mais bascule sur l'évaluateur de secours.
 * Le compteur est persisté : un redémarrage ne remet pas le budget à zéro.
 */

const today = () => new Date().toISOString().slice(0, 10);

export function callsToday(date = today()) {
  const row = db.prepare('SELECT calls FROM api_usage WHERE date = ?').get(date);
  return row ? row.calls : 0;
}

/** Reste-t-il du budget pour un appel ? */
export function hasBudget() {
  if (!config.dailyApiBudget || config.dailyApiBudget <= 0) return true;
  return callsToday() < config.dailyApiBudget;
}

/** Enregistre un appel facturé. */
export function consume(n = 1) {
  const date = today();
  db.prepare(
    `INSERT INTO api_usage (date, calls) VALUES (?, ?)
     ON CONFLICT(date) DO UPDATE SET calls = calls + excluded.calls`
  ).run(date, n);
}

export function budgetStatus() {
  const used = callsToday();
  const limit = config.dailyApiBudget;
  return {
    used,
    limit,
    remaining: limit > 0 ? Math.max(0, limit - used) : null,
    exhausted: limit > 0 && used >= limit,
  };
}
