import { db } from './db.js';
import { config } from './config.js';
import { isAdmin } from './auth.js';

/**
 * Le quota de duels quotidiens.
 *
 * Deux duels par jour en gratuit, vingt pour un abonné. Le compte se lit dans
 * `multiplay_games`, où chaque partie terminée laisse une ligne — y compris
 * les abandons et les déconnexions, qui ont coûté leurs appels à l'IA comme
 * les autres. Une partie en cours n'y figure pas encore : c'est voulu, un
 * joueur ne peut de toute façon être que dans une seule à la fois.
 *
 * Le droit premium est relu en base à chaque appel plutôt que pris sur la
 * socket : un joueur qui s'abonne pendant sa session ne doit pas avoir à se
 * reconnecter pour en profiter.
 */
export function duelQuota(userId) {
  // L'e-mail est lu pour le droit d'administration, qui vaut premium (voir
  // findUserById) : le quota ne doit pas contredire le reste du jeu.
  const row = db.prepare('SELECT is_premium, email FROM users WHERE id = ?').get(userId);
  const premium = Boolean(row?.is_premium) || isAdmin(row);

  const max = premium ? config.game.duelsPerDayPremium : config.game.duelsPerDayFree;
  const played = db
    .prepare(
      `SELECT COUNT(*) AS n FROM multiplay_games
        WHERE (player_a_id = ? OR player_b_id = ?) AND date(started_at) = date('now')`
    )
    .get(userId, userId).n;

  return {
    isPremium: premium,
    played,
    max,
    remaining: Math.max(0, max - played),
    freeMax: config.game.duelsPerDayFree,
    premiumMax: config.game.duelsPerDayPremium,
  };
}
