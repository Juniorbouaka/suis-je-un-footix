import { db } from './db.js';
import { config } from './config.js';
import { getSubscription } from './paypal.js';

/**
 * État de l'abonnement premium.
 *
 * Principe : `premium_until` est la date de fin des droits, `is_premium` le
 * drapeau effectif. Une résiliation ne coupe rien sur le champ — le joueur
 * a payé sa période, il la termine. C'est `expireIfNeeded` qui retire les
 * droits, paresseusement, à la première requête suivant l'échéance.
 */

/** Quelques jours de battement : un prélèvement PayPal peut prendre du retard. */
const GRACE_DAYS = 3;

export const PLANS = {
  monthly: {
    key: 'monthly',
    label: 'Mensuel',
    price: config.premium.monthlyPrice,
    period: 'par mois',
    planId: () => config.paypal.plans.monthly,
  },
  yearly: {
    key: 'yearly',
    label: 'Annuel',
    price: config.premium.yearlyPrice,
    period: 'par an',
    planId: () => config.paypal.plans.yearly,
  },
};

/** Fin des droits déduite de l'abonnement PayPal, marge comprise. */
function computePremiumUntil(subscription) {
  const next = subscription?.billing_info?.next_billing_time;
  if (!next) return null;
  const date = new Date(next);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + GRACE_DAYS);
  return date.toISOString();
}

/**
 * Retire les droits premium si l'échéance est passée.
 * Appelé à chaque lecture du compte : c'est le seul endroit où le premium
 * s'éteint, il n'y a donc pas de tâche planifiée à maintenir.
 */
export function expireIfNeeded(user) {
  if (!user || !user.is_premium) return user;
  if (!user.premium_until) return user; // premium accordé à la main, sans échéance
  if (new Date(user.premium_until) > new Date()) return user;

  db.prepare('UPDATE users SET is_premium = 0 WHERE id = ?').run(user.id);
  return { ...user, is_premium: 0 };
}

/** Applique un abonnement PayPal à un compte. */
export function applySubscription(userId, subscription, planKey = null) {
  const status = subscription?.status || 'UNKNOWN';
  const until = computePremiumUntil(subscription);
  const active = status === 'ACTIVE' || status === 'APPROVED';

  const current = db
    .prepare('SELECT premium_until FROM users WHERE id = ?')
    .get(userId);

  // On ne raccourcit jamais une échéance déjà acquise : à la résiliation,
  // PayPal cesse de renvoyer next_billing_time et `until` devient null.
  const nextUntil = until || current?.premium_until || null;

  db.prepare(
    `UPDATE users
        SET is_premium = ?,
            subscription_provider = 'paypal',
            subscription_id = ?,
            subscription_status = ?,
            subscription_plan = COALESCE(?, subscription_plan),
            premium_until = ?
      WHERE id = ?`
  ).run(
    active || (nextUntil && new Date(nextUntil) > new Date()) ? 1 : 0,
    subscription?.id || null,
    status,
    planKey,
    nextUntil,
    userId
  );

  return { status, premiumUntil: nextUntil, isPremium: active };
}

/** Recharge l'abonnement depuis PayPal et met le compte à jour. */
export async function syncSubscription(userId, subscriptionId, planKey = null) {
  const subscription = await getSubscription(subscriptionId);

  // Garde-fou : l'abonnement doit bien appartenir au compte qui le réclame.
  if (subscription.custom_id && subscription.custom_id !== userId) {
    const err = new Error("Cet abonnement appartient à un autre compte.");
    err.status = 403;
    throw err;
  }

  return applySubscription(userId, subscription, planKey);
}

/* ------------------------------------------------------------------ *
 *  Stripe
 * ------------------------------------------------------------------ */

/** Statuts Stripe qui ouvrent effectivement les droits. */
const STRIPE_ACTIFS = new Set(['active', 'trialing', 'past_due']);

/**
 * Applique un abonnement Stripe à un compte.
 *
 * Même principe que côté PayPal : `current_period_end` donne l'échéance,
 * et une résiliation (`cancel_at_period_end`) ne coupe rien sur le champ.
 * `past_due` reste actif volontairement — un prélèvement en retard n'est pas
 * une résiliation, Stripe réessaie plusieurs jours.
 */
export function applyStripeSubscription(userId, subscription, planKey = null) {
  const status = subscription?.status || 'unknown';
  const fin = subscription?.current_period_end;

  let until = null;
  if (Number.isFinite(fin)) {
    const date = new Date(fin * 1000);
    date.setUTCDate(date.getUTCDate() + GRACE_DAYS);
    until = date.toISOString();
  }

  const current = db.prepare('SELECT premium_until FROM users WHERE id = ?').get(userId);
  const nextUntil = until || current?.premium_until || null;
  const actif = STRIPE_ACTIFS.has(status);

  db.prepare(
    `UPDATE users
        SET is_premium = ?,
            subscription_provider = 'stripe',
            subscription_id = ?,
            subscription_status = ?,
            subscription_plan = COALESCE(?, subscription_plan),
            premium_until = ?
      WHERE id = ?`
  ).run(
    actif || (nextUntil && new Date(nextUntil) > new Date()) ? 1 : 0,
    subscription?.id || null,
    // On note la résiliation programmée : le joueur doit voir « premium
    // jusqu'au … » plutôt que « abonné ».
    subscription?.cancel_at_period_end ? 'CANCELLED' : status.toUpperCase(),
    planKey,
    nextUntil,
    userId
  );

  return { status, premiumUntil: nextUntil, isPremium: actif };
}

/**
 * Idempotence des webhooks, en deux temps.
 *
 * L'enregistrement n'a lieu qu'APRÈS un traitement réussi : si on marquait
 * l'événement dès sa réception, un échec suivi d'un réessai de PayPal
 * serait écarté comme « déjà traité » et l'abonnement resterait faux.
 */
export function alreadyProcessed(id) {
  return Boolean(db.prepare('SELECT 1 FROM billing_events WHERE id = ?').get(id));
}

export function markProcessed(id, type, userId, payload) {
  db.prepare(
    'INSERT OR IGNORE INTO billing_events (id, type, user_id, payload) VALUES (?, ?, ?, ?)'
  ).run(id, type, userId || null, JSON.stringify(payload).slice(0, 20000));
}

/** Retrouve le compte visé par un événement d'abonnement. */
export function userIdForSubscription(subscriptionId, customId) {
  if (customId) {
    const byCustom = db.prepare('SELECT id FROM users WHERE id = ?').get(customId);
    if (byCustom) return byCustom.id;
  }
  if (!subscriptionId) return null;
  const row = db.prepare('SELECT id FROM users WHERE subscription_id = ?').get(subscriptionId);
  return row?.id || null;
}

/** Résumé de l'abonnement pour le client. */
export function billingSummary(user) {
  return {
    isPremium: Boolean(user.is_premium),
    // Premium sans abonnement : administrateur, ou geste accordé à la main.
    // Il n'y a rien à résilier et aucune échéance à afficher — le profil doit
    // le dire au lieu d'inventer une « formule mensuelle ».
    manual: Boolean(user.is_premium) && !user.subscription_id,
    plan: user.subscription_plan || null,
    status: user.subscription_status || null,
    premiumUntil: user.premium_until || null,
    // Un abonnement résilié reste actif jusqu'à l'échéance : le client doit
    // pouvoir dire « premium jusqu'au … » plutôt que « abonné ».
    cancelled: user.subscription_status === 'CANCELLED',
    provider: user.subscription_provider || null,
  };
}
