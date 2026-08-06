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

export function multiplayerScore({ won, attempts, durationMs, streak = 0 }) {
  if (!won) return 50;
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
      pvpStreak: 0,
      languages: ['fr'],
      ...JSON.parse(row.stats_json || '{}'),
    };
  } catch {
    return { totalScore: 0, daysCompleted: 0, currentStreak: 0, bestStreak: 0, pvpWins: 0, pvpLosses: 0, pvpStreak: 0 };
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

export function recordPvpResult(userId, { won, points }) {
  const stats = readStats(userId);
  if (won) {
    stats.pvpWins += 1;
    stats.pvpStreak = (stats.pvpStreak || 0) + 1;
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
