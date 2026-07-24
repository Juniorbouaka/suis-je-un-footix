import { db } from './db.js';
import { readStats } from './scoring.js';

/** Catalogue des médailles (cahier des charges §9). */
export const ACHIEVEMENTS = [
  { code: 'first_blood', name: 'Première partie', description: 'Complète ta première partie.' },
  { code: 'streak_7', name: 'Sept jours', description: 'Connecté 7 jours de suite.' },
  { code: 'speed_runner', name: 'Éclair', description: 'Mot trouvé en moins de 30 secondes.' },
  { code: 'semantic_master', name: 'Maître sémantique', description: 'Atteins 1000 points sur une partie solo.' },
  { code: 'champion', name: 'Champion', description: 'Entre dans le top 1 % du classement.' },
  { code: 'trickster', name: 'Filou', description: 'Gagne une partie en duel avec un mot d’une lettre.' },
  { code: 'polyglot', name: 'Polyglotte', description: 'Joue dans 3 langues différentes.' },
  { code: 'sharpshooter', name: 'Tireur d’élite', description: 'Trouve le mot du jour en 3 tentatives ou moins.' },
  { code: 'duelist', name: 'Duelliste', description: 'Remporte ta première partie en duel.' },
];

const BY_CODE = new Map(ACHIEVEMENTS.map((a) => [a.code, a]));

export function grant(userId, code) {
  if (!BY_CODE.has(code)) return null;
  const before = db.prepare('SELECT 1 FROM achievements WHERE user_id = ? AND code = ?').get(userId, code);
  if (before) return null;
  db.prepare('INSERT OR IGNORE INTO achievements (user_id, code) VALUES (?, ?)').run(userId, code);
  return BY_CODE.get(code);
}

export function listFor(userId) {
  const owned = new Map(
    db
      .prepare('SELECT code, earned_at FROM achievements WHERE user_id = ?')
      .all(userId)
      .map((r) => [r.code, r.earned_at])
  );
  return ACHIEVEMENTS.map((a) => ({
    ...a,
    earned: owned.has(a.code),
    earnedAt: owned.get(a.code) || null,
  }));
}

/** Évalue toutes les médailles après une partie solo. Renvoie les nouvelles. */
export function evaluateSolo(userId, { attempts, seconds, score }) {
  const stats = readStats(userId);
  const unlocked = [];

  const maybe = (code, condition) => {
    if (!condition) return;
    const got = grant(userId, code);
    if (got) unlocked.push(got);
  };

  maybe('first_blood', true);
  maybe('speed_runner', seconds < 30);
  maybe('semantic_master', score >= 1000);
  maybe('sharpshooter', attempts <= 3);
  maybe('streak_7', (stats.currentStreak || 0) >= 7);

  // Top 1 % du classement
  const total = db.prepare('SELECT COUNT(*) AS n FROM daily_results GROUP BY user_id').all().length;
  if (total >= 10) {
    const ranked = db
      .prepare(
        `SELECT user_id, SUM(score) AS total FROM daily_results
         WHERE outcome = 'found' GROUP BY user_id ORDER BY total DESC`
      )
      .all();
    const position = ranked.findIndex((r) => r.user_id === userId);
    maybe('champion', position >= 0 && position < Math.max(1, Math.ceil(ranked.length * 0.01)));
  }

  return unlocked;
}

/** Évalue les médailles après une partie multijoueur. */
export function evaluatePvp(userId, { won, secretWord }) {
  const unlocked = [];
  const maybe = (code, condition) => {
    if (!condition) return;
    const got = grant(userId, code);
    if (got) unlocked.push(got);
  };

  maybe('first_blood', true);
  maybe('duelist', won);
  maybe('trickster', won && String(secretWord || '').trim().length === 1);

  return unlocked;
}
