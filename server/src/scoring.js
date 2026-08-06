import { db } from './db.js';

/* ------------------------------------------------------------------ *
 *  Scoring solo (cahier des charges §9)
 *    Base 1000 — 50 par tentative supplémentaire + bonus de rapidité
 * ------------------------------------------------------------------ */

export function soloScore({ attempts, seconds }) {
  const base = 1000;
  const penalty = Math.max(0, attempts - 1) * 50;
  const timeBonus = seconds < 3600 ? Math.round((3600 - seconds) / 10) : 0;
  return Math.max(100, base - penalty + timeBonus);
}

/* ------------------------------------------------------------------ *
 *  Scoring multijoueur
 * ------------------------------------------------------------------ */

/**
 * Points d'un duel.
 *
 * Le match nul vaut le double de la défaite sans approcher la victoire :
 * avoir tenu ses quinze essais face à un adversaire qui a échoué aussi, ce
 * n'est pas gagner, mais ce n'est pas non plus abandonner au premier tour.
 */
export function multiplayerScore({
  won,
  draw = false,
  attempts,
  durationMs,
  streak = 0,
  // Victoire obtenue parce que l'adversaire a quitté la partie — forfait,
  // abandon ou déconnexion — et non parce qu'on a trouvé le joueur mystère.
  walkover = false,
}) {
  if (!won) return draw ? 100 : 50;

  /*
   * Le forfait vaut une victoire, mais pas le prix d'une victoire.
   *
   * Avant, gagner sur forfait rapportait 343 points quand trouver le joueur
   * en trois essais en rapportait 378 : presque la même chose pour un
   * résultat qui n'a rien à voir. Pire, les deux bonus mentaient. Le bonus de
   * rapidité récompensait le fait que l'adversaire soit parti tôt — plus il
   * partait vite, plus on gagnait. Le bonus d'efficacité récompensait un
   * nombre de tentatives qui n'a rien trouvé.
   *
   * Un forfait paie donc un montant fixe : au-dessus du match nul, parce
   * qu'être resté vaut mieux qu'être parti, et loin en dessous d'une vraie
   * victoire, parce que le joueur mystère n'a pas été trouvé.
   */
  if (walkover) return 150;

  const speedBonus = Math.max(0, Math.round((600_000 - durationMs) / 10_000));
  const efficiency = Math.max(0, 100 - Math.max(0, attempts - 1) * 10);
  return 200 + speedBonus + efficiency + streak * 50;
}

/* ------------------------------------------------------------------ *
 *  Statistiques joueur
 * ------------------------------------------------------------------ */

export function readStats(userId) {
  const row = db.prepare('SELECT stats_json FROM users WHERE id = ?').get(userId);
  if (!row) return null;
  try {
    return {
      totalScore: 0,
      daysCompleted: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastPlayedDate: null,
      bestAttempts: null,
      fastestSeconds: null,
      pvpWins: 0,
      pvpLosses: 0,
      pvpDraws: 0,
      pvpStreak: 0,
      languages: ['fr'],
      ...JSON.parse(row.stats_json || '{}'),
    };
  } catch {
    return { totalScore: 0, daysCompleted: 0, currentStreak: 0, bestStreak: 0, pvpWins: 0, pvpLosses: 0, pvpDraws: 0, pvpStreak: 0 };
  }
}

export function writeStats(userId, stats) {
  db.prepare('UPDATE users SET stats_json = ? WHERE id = ?').run(JSON.stringify(stats), userId);
}

function yesterdayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Met à jour les stats après une partie solo gagnée. */
export function recordSoloWin(userId, { date, attempts, seconds, score }) {
  const stats = readStats(userId);

  stats.daysCompleted += 1;
  stats.totalScore += score;
  stats.currentStreak =
    stats.lastPlayedDate === yesterdayOf(date) ? (stats.currentStreak || 0) + 1 : 1;
  stats.bestStreak = Math.max(stats.bestStreak || 0, stats.currentStreak);
  stats.lastPlayedDate = date;
  stats.bestAttempts = stats.bestAttempts ? Math.min(stats.bestAttempts, attempts) : attempts;
  stats.fastestSeconds = stats.fastestSeconds ? Math.min(stats.fastestSeconds, seconds) : seconds;
  stats.avgScore = Math.round(stats.totalScore / stats.daysCompleted);

  writeStats(userId, stats);
  return stats;
}

/**
 * Enregistre l'issue d'un duel.
 *
 * Le nul ne touche ni aux victoires ni aux défaites : il a sa colonne. Et il
 * laisse la série en l'état — elle ne repart pas de zéro parce que personne
 * n'a trouvé, mais elle ne progresse pas non plus sans victoire.
 */
export function recordPvpResult(userId, { won, draw = false, points, walkover = false }) {
  const stats = readStats(userId);
  if (won) {
    stats.pvpWins += 1;
    /*
     * Une victoire sur forfait compte comme victoire, mais ne PROLONGE pas la
     * série : une série de victoires raconte une suite de duels gagnés sur le
     * terrain, pas une suite d'adversaires partis. Elle n'est pas cassée non
     * plus — le joueur n'a rien fait de mal, il était là.
     */
    if (!walkover) stats.pvpStreak = (stats.pvpStreak || 0) + 1;
  } else if (draw) {
    stats.pvpDraws = (stats.pvpDraws || 0) + 1;
  } else {
    stats.pvpLosses += 1;
    stats.pvpStreak = 0;
  }
  stats.totalScore += points;
  writeStats(userId, stats);
  return stats;
}

/* ------------------------------------------------------------------ *
 *  Rang, dérivé du nombre de jours complétés et du score moyen
 * ------------------------------------------------------------------ */

const RANKS = [
  { name: 'Novice', min: 0 },
  { name: 'Apprenti', min: 3 },
  { name: 'Lettré', min: 10 },
  { name: 'Érudit', min: 25 },
  { name: 'Maître des mots', min: 50 },
  { name: 'Légende sémantique', min: 100 },
];

export function rankFor(stats) {
  const days = stats?.daysCompleted || 0;
  let current = RANKS[0];
  for (const r of RANKS) if (days >= r.min) current = r;
  const next = RANKS.find((r) => r.min > days) || null;
  return { name: current.name, next: next?.name || null, toNext: next ? next.min - days : 0 };
}
