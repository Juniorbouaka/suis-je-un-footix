/**
 * Tableau de bord d'administration.
 *
 * Réservé aux adresses listées dans ADMIN_EMAILS (voir config.js). Toutes
 * les mesures sortent de la base du jeu : rien n'est envoyé à un service
 * tiers, et aucun mouchard n'est posé chez le visiteur.
 *
 * Les journées sont découpées en UTC, comme le joueur du jour : un même
 * chiffre doit vouloir dire la même chose partout dans l'application.
 */

import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { todayUtc } from '../words.js';
import { onlineCount, peakCount } from '../presence.js';
import { budgetStatus } from '../budget.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

const count = (sql, ...params) => db.prepare(sql).get(...params)?.n ?? 0;

/** Liste des N derniers jours (UTC), du plus ancien au plus récent. */
function lastDays(days) {
  const out = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Regroupe des lignes { d, ... } par date pour un accès direct. */
function byDate(rows) {
  const map = new Map();
  for (const r of rows) map.set(r.d, r);
  return map;
}

/* -------------------------------------------------------------- *
 *  GET /api/admin/stats?days=30
 * -------------------------------------------------------------- */

adminRouter.get('/stats', (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 180);
  const since = lastDays(days)[0];

  /* --- Comptes ------------------------------------------------- */
  const users = {
    total: count('SELECT COUNT(*) AS n FROM users'),
    today: count("SELECT COUNT(*) AS n FROM users WHERE date(created_at) = date('now')"),
    last7: count("SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now', '-7 day')"),
    last30: count("SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now', '-30 day')"),
    // Comptes créés mais qui n'ont jamais proposé le moindre mot : c'est le
    // symptôme le plus parlant d'une inscription qui ne convertit pas.
    dormant: count(
      'SELECT COUNT(*) AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM guesses g WHERE g.user_id = u.id)'
    ),
  };

  /* --- Connexions ---------------------------------------------- */
  const logins = {
    today: count("SELECT COUNT(*) AS n FROM login_events WHERE date(created_at) = date('now')"),
    last7: count("SELECT COUNT(*) AS n FROM login_events WHERE created_at >= datetime('now', '-7 day')"),
    last30: count("SELECT COUNT(*) AS n FROM login_events WHERE created_at >= datetime('now', '-30 day')"),
    // Comptes ayant ouvert une session au moins une fois sur la période.
    uniqueLast7: count(
      "SELECT COUNT(DISTINCT user_id) AS n FROM login_events WHERE created_at >= datetime('now', '-7 day')"
    ),
  };

  /*
   * Actifs = comptes ayant réellement joué (une proposition suffit), partie
   * du jour ou archive confondues. La simple visite ne compte pas : un
   * onglet ouvert n'est pas un joueur.
   */
  const activeSince = (expr) =>
    count(
      `SELECT COUNT(*) AS n FROM (
         SELECT user_id FROM guesses WHERE created_at >= ${expr}
         UNION
         SELECT user_id FROM archive_guesses WHERE created_at >= ${expr}
       )`
    );

  const active = {
    today: activeSince("date('now')"),
    last7: activeSince("datetime('now', '-7 day')"),
    last30: activeSince("datetime('now', '-30 day')"),
  };

  /*
   * Fidélité : part des inscrits revenus jouer un second jour. Un joueur qui
   * ne revient pas est un joueur perdu, et aucun chiffre de fréquentation ne
   * le dit à la place de celui-ci.
   */
  const returning = count(
    `SELECT COUNT(*) AS n FROM (
       SELECT user_id FROM daily_results GROUP BY user_id HAVING COUNT(DISTINCT date) >= 2
     )`
  );
  const played = count('SELECT COUNT(DISTINCT user_id) AS n FROM daily_results');

  /* --- Abonnements et dons ------------------------------------- */
  const premium = {
    active: count('SELECT COUNT(*) AS n FROM users WHERE is_premium = 1'),
    monthly: count("SELECT COUNT(*) AS n FROM users WHERE is_premium = 1 AND subscription_plan = 'monthly'"),
    yearly: count("SELECT COUNT(*) AS n FROM users WHERE is_premium = 1 AND subscription_plan = 'yearly'"),
    // Résiliés qui terminent leur période payée : ils comptent encore comme
    // abonnés aujourd'hui, mais plus le mois prochain.
    cancelled: count("SELECT COUNT(*) AS n FROM users WHERE is_premium = 1 AND subscription_status = 'CANCELLED'"),
  };

  const don = db
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(CAST(amount AS REAL)), 0) AS total FROM donations WHERE status = 'COMPLETED'"
    )
    .get();

  /* --- Séries quotidiennes ------------------------------------- */
  const signupRows = byDate(
    db
      .prepare('SELECT date(created_at) AS d, COUNT(*) AS n FROM users WHERE created_at >= ? GROUP BY d')
      .all(since)
  );
  const loginRows = byDate(
    db
      .prepare(
        `SELECT date(created_at) AS d, COUNT(*) AS n, COUNT(DISTINCT user_id) AS u
           FROM login_events WHERE created_at >= ? GROUP BY d`
      )
      .all(since)
  );
  const guessRows = byDate(
    db
      .prepare(
        `SELECT date(created_at) AS d, COUNT(*) AS n, COUNT(DISTINCT user_id) AS u
           FROM guesses WHERE created_at >= ? GROUP BY d`
      )
      .all(since)
  );
  const gameRows = byDate(
    db
      .prepare(
        `SELECT date(created_at) AS d, COUNT(*) AS n,
                SUM(CASE WHEN outcome = 'found' THEN 1 ELSE 0 END) AS f
           FROM daily_results WHERE created_at >= ? GROUP BY d`
      )
      .all(since)
  );

  const series = lastDays(days).map((date) => ({
    date,
    signups: signupRows.get(date)?.n ?? 0,
    logins: loginRows.get(date)?.n ?? 0,
    activeAccounts: guessRows.get(date)?.u ?? 0,
    guesses: guessRows.get(date)?.n ?? 0,
    games: gameRows.get(date)?.n ?? 0,
    solved: gameRows.get(date)?.f ?? 0,
  }));

  /* --- Derniers inscrits --------------------------------------- */
  const latestSignups = db
    .prepare(
      `SELECT u.username, u.created_at, u.last_login_at, u.last_seen_at, u.is_premium,
              (SELECT COUNT(*) FROM daily_results r WHERE r.user_id = u.id) AS games
         FROM users u ORDER BY u.created_at DESC LIMIT 12`
    )
    .all()
    .map((r) => ({
      username: r.username,
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at,
      lastSeenAt: r.last_seen_at,
      isPremium: Boolean(r.is_premium),
      games: r.games,
    }));

  /* --- Dernières connexions ------------------------------------ */
  const latestLogins = db
    .prepare(
      `SELECT u.username, e.kind, e.created_at
         FROM login_events e JOIN users u ON u.id = e.user_id
         ORDER BY e.id DESC LIMIT 12`
    )
    .all()
    .map((r) => ({ username: r.username, kind: r.kind, at: r.created_at }));

  res.json({
    generatedAt: new Date().toISOString(),
    date: todayUtc(),
    days,
    live: { online: onlineCount(), peak: peakCount() },
    users,
    logins,
    active,
    loyalty: {
      played,
      returning,
      rate: played ? Math.round((returning / played) * 100) : 0,
    },
    premium,
    donations: { count: don.n, total: Math.round(don.total * 100) / 100 },
    // Les appels à Claude sont le seul poste de dépense variable du jeu :
    // ils ont leur place à côté des recettes.
    budget: budgetStatus(),
    series,
    latestSignups,
    latestLogins,
  });
});

/* -------------------------------------------------------------- *
 *  GET /api/admin/users?q=&limit=50
 * -------------------------------------------------------------- */

adminRouter.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

  const where = q ? 'WHERE lower(u.username) LIKE ? OR lower(u.email) LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];

  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.email, u.created_at, u.last_login_at, u.last_seen_at,
              u.is_premium, u.subscription_plan, u.subscription_status, u.premium_until,
              (SELECT COUNT(*) FROM daily_results r WHERE r.user_id = u.id) AS games,
              (SELECT COUNT(*) FROM login_events e WHERE e.user_id = u.id) AS logins
         FROM users u ${where}
         ORDER BY COALESCE(u.last_seen_at, u.created_at) DESC
         LIMIT ?`
    )
    .all(...params, limit);

  res.json({
    total: count('SELECT COUNT(*) AS n FROM users'),
    entries: rows.map((r) => ({
      id: r.id,
      username: r.username,
      email: r.email,
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at,
      lastSeenAt: r.last_seen_at,
      isPremium: Boolean(r.is_premium),
      plan: r.subscription_plan,
      subscriptionStatus: r.subscription_status,
      premiumUntil: r.premium_until,
      games: r.games,
      logins: r.logins,
    })),
  });
});
