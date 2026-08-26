import { db } from './db.js';
import { config } from './config.js';
import { getSubscription } from './paypal.js';
import { balanceOf, creditSummary, grantOnPlanChange, rechargeOnRenewal } from './credits.js';
import { duelTrialState, trialState } from './trial.js';
import { notifySale } from './notify.js';

/**
 * État de l'abonnement.
 *
 * Principe : `premium_until` est la date de fin des droits, `is_subscriber`
 * et `is_premium` les drapeaux effectifs. Une résiliation ne coupe rien sur
 * le champ — le joueur a payé sa période, il la termine. C'est
 * `expireIfNeeded` qui retire les droits, paresseusement, à la première
 * requête suivant l'échéance.
 */

/** Quelques jours de battement : un prélèvement PayPal peut prendre du retard. */
const GRACE_DAYS = 3;

/*
 * Les deux forfaits, du moins cher au plus cher.
 *
 * L'ordre compte : la page d'offre les affiche dans cet ordre, et c'est
 * l'ordre de lecture naturel — on entre par le prix d'appel.
 *
 * `premium` distingue le forfait qui ouvre tout le reste (50 chances, 5
 * parties, 5 duels, sans publicité, archives complètes). Il n'y a qu'une
 * seule définition de cette frontière dans le code, et c'est celle-ci :
 * ailleurs on lit `is_premium`, calculé à partir d'ici.
 */
export const PLANS = {
  access: {
    key: 'access',
    label: 'Accès',
    price: config.premium.accessPrice,
    period: 'par mois',
    credits: config.credits.perPlan.access,
    premium: false,
    planId: () => config.paypal.plans.access,
  },
  unlimited: {
    key: 'unlimited',
    label: 'Illimité',
    price: config.premium.unlimitedPrice,
    period: 'par mois',
    credits: config.credits.perPlan.unlimited,
    premium: true,
    planId: () => config.paypal.plans.unlimited,
  },
};

/**
 * Ce forfait ouvre-t-il les droits du haut de gamme ?
 *
 * Tolérant par choix. Une clé inconnue — une ancienne formule oubliée dans
 * un webhook en retard, un compte réparé à la main — rend `true` : entre
 * rétrograder un abonné à tort et offrir quelques chances de trop, le
 * second est de très loin le moins grave. Seul le forfait Accès, nommément
 * reconnu, limite les droits.
 */
export function planIsPremium(planKey) {
  return PLANS[planKey]?.premium ?? planKey !== PLANS.access.key;
}

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
 * Retire les droits si l'échéance est passée.
 *
 * Appelé à chaque lecture du compte : c'est le seul endroit où l'abonnement
 * s'éteint, il n'y a donc pas de tâche planifiée à maintenir.
 *
 * Les deux drapeaux tombent ensemble. Ne retirer que `is_premium` laisserait
 * la porte du jeu ouverte à un abonnement expiré depuis six mois — le mur de
 * paiement ne tient que si l'expiration le referme.
 */
export function expireIfNeeded(user) {
  if (!user) return user;
  if (!user.is_premium && !user.is_subscriber) return user;
  if (!user.premium_until) return user; // accordé à la main, sans échéance
  if (new Date(user.premium_until) > new Date()) return user;

  db.prepare('UPDATE users SET is_premium = 0, is_subscriber = 0 WHERE id = ?').run(user.id);
  return { ...user, is_premium: 0, is_subscriber: 0 };
}

/**
 * Écrit les droits d'un compte à partir d'un abonnement.
 *
 * Mise en commun délibérée entre PayPal et Stripe : la règle « payé, donc
 * on entre — et forfait Illimité, donc on a tout » ne doit exister qu'à un
 * seul endroit. Elle avait déjà divergé une fois entre les deux
 * encaisseurs, et c'est le genre d'écart qu'on ne découvre qu'en lisant les
 * réclamations d'un joueur.
 *
 * `planKey` peut être nul (un webhook de renouvellement ne rappelle pas
 * toujours la formule) : on relit alors celle déjà enregistrée, jamais on ne
 * devine. C'est ce qui évite de rétrograder un abonné au passage d'un
 * simple événement de paiement.
 */
/**
 * Prévient par e-mail qu'une vente vient d'avoir lieu.
 *
 * Posée ici, dans `writeRights`, parce que c'est le seul endroit du code où
 * PayPal et Stripe se rejoignent : une alerte par encaisseur aurait divergé
 * comme le reste avait divergé avant leur mise en commun, et on s'en serait
 * aperçu en ne recevant rien pour la moitié des ventes.
 *
 * On distingue trois moments, et on ne dit rien pour tout le reste :
 *
 *   souscription   aucune échéance connue avant : c'est un nouvel abonné.
 *   renouvellement l'échéance a AVANCÉ — c'est le même signal qui déclenche
 *                  la recharge de crédits, et pour la même raison : une
 *                  période vient d'être payée.
 *   formule        le forfait a changé sur un compte déjà abonné.
 *
 * Le reste — synchronisations, webhooks de statut, résiliations — n'est pas
 * de l'argent qui rentre. Les annoncer noierait les trois lignes qui
 * comptent, et une boîte mail qu'on cesse d'ouvrir ne prévient plus de rien.
 */
function annoncerVente(userId, { provider, subscriptionId, plan, planAvant, echeanceAvant, nextUntil }) {
  const formule = PLANS[plan];
  const prix = formule ? `${formule.price} €/mois` : 'montant inconnu';
  const label = formule?.label || plan || 'formule inconnue';

  const apres = nextUntil ? Date.parse(nextUntil) : 0;
  const avant = echeanceAvant ? Date.parse(echeanceAvant) : 0;

  let kind = null;
  let resume = null;

  if (!echeanceAvant && !planAvant) {
    kind = 'abonnement';
    resume = `Nouvel abonné — ${label}, ${prix}`;
  } else if (planAvant && plan !== planAvant) {
    kind = 'formule';
    resume = `Changement de formule — ${PLANS[planAvant]?.label || planAvant} → ${label}, ${prix}`;
  } else if (apres && apres > avant) {
    kind = 'renouvellement';
    resume = `Renouvellement — ${label}, ${prix}`;
  }

  if (!kind) return;

  notifySale({
    kind,
    // L'échéance entre dans la référence : c'est ce qui fait qu'un
    // renouvellement du mois prochain est une autre vente, alors que le
    // retour du navigateur et le webhook d'aujourd'hui n'en font qu'une.
    ref: `${kind}:${subscriptionId || userId}:${nextUntil || 'sans-echeance'}`,
    resume,
    userId,
    details: [
      `Encaisseur : ${provider || 'inconnu'}`,
      `Échéance   : ${nextUntil ? new Date(nextUntil).toLocaleDateString('fr-FR') : 'aucune'}`,
    ],
  });
}

function writeRights(userId, { provider, subscriptionId, status, planKey, until, active }) {
  const current = db
    .prepare('SELECT premium_until, subscription_plan FROM users WHERE id = ?')
    .get(userId);

  // Photographiés AVANT l'écriture : ce sont eux qui diront, après, si une
  // période vient d'être payée et si la formule a changé. Relus après coup,
  // ils auraient déjà la nouvelle valeur et ne compareraient plus rien.
  const echeanceAvant = current?.premium_until || null;
  const planAvant = current?.subscription_plan || null;

  // On ne raccourcit jamais une échéance déjà acquise : à la résiliation,
  // l'encaisseur cesse d'annoncer la prochaine, et `until` devient null.
  const nextUntil = until || current?.premium_until || null;
  const plan = planKey || current?.subscription_plan || null;

  // Les droits courent tant que la période payée n'est pas écoulée, même si
  // l'abonnement n'est plus « actif » : c'est toute la différence entre
  // résilier et être coupé.
  const abonne = active || (nextUntil && new Date(nextUntil) > new Date()) ? 1 : 0;
  const premium = abonne && planIsPremium(plan) ? 1 : 0;

  db.prepare(
    `UPDATE users
        SET is_subscriber = ?,
            is_premium = ?,
            subscription_provider = ?,
            subscription_id = ?,
            subscription_status = ?,
            subscription_plan = COALESCE(?, subscription_plan),
            premium_until = ?
      WHERE id = ?`
  ).run(abonne, premium, provider, subscriptionId, status, planKey, nextUntil, userId);

  /*
   * Les crédits suivent le paiement, dans cet ordre précis.
   *
   * Le changement de formule est traité EN DERNIER et écrase donc la
   * recharge de renouvellement si les deux tombent ensemble. C'est voulu :
   * quelqu'un qui passe à l'Illimité le jour de son échéance doit repartir
   * avec le stock de l'Illimité, pas avec celui qu'il vient de quitter.
   *
   * Les deux opérations écrivent un solde absolu et non un incrément : les
   * enchaîner ne distribue pas deux stocks.
   */
  if (abonne) {
    rechargeOnRenewal(userId, echeanceAvant);
    if (plan !== planAvant) grantOnPlanChange(userId, planAvant);
    annoncerVente(userId, { provider, subscriptionId, plan, planAvant, echeanceAvant, nextUntil });
  }

  return {
    status,
    premiumUntil: nextUntil,
    plan,
    hasAccess: Boolean(abonne),
    isPremium: Boolean(premium),
    credits: balanceOf(userId),
  };
}

/** Applique un abonnement PayPal à un compte. */
export function applySubscription(userId, subscription, planKey = null) {
  const status = subscription?.status || 'UNKNOWN';

  return writeRights(userId, {
    provider: 'paypal',
    subscriptionId: subscription?.id || null,
    status,
    planKey,
    until: computePremiumUntil(subscription),
    active: status === 'ACTIVE' || status === 'APPROVED',
  });
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

  return writeRights(userId, {
    provider: 'stripe',
    subscriptionId: subscription?.id || null,
    // On note la résiliation programmée : le joueur doit voir « abonné
    // jusqu'au … » plutôt que « abonné ».
    status: subscription?.cancel_at_period_end ? 'CANCELLED' : status.toUpperCase(),
    planKey,
    until,
    active: STRIPE_ACTIFS.has(status),
  });
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
    // Le droit d'entrer dans le jeu — vrai avec l'un ou l'autre forfait.
    hasAccess: Boolean(user.is_subscriber || user.is_premium),
    /*
     * L'essai, et le droit d'ouvrir la partie du jour qui en découle.
     *
     * Ils voyagent avec l'abonnement parce que c'est la même question côté
     * joueur — « qu'est-ce que je peux faire maintenant ? » — et que
     * l'écran de jeu la pose au chargement, avant tout appel de partie.
     * Les séparer aurait demandé un second aller-retour pour afficher
     * correctement le premier écran.
     */
    canPlay: Boolean(user.is_subscriber || user.is_premium) || trialState(user).remaining > 0,
    trial: trialState(user),
    /*
     * Le duel offert voyage avec le reste, et pour la même raison : c'est
     * toujours la même question côté joueur, « qu'est-ce que je peux faire
     * maintenant ? ». L'écran d'accueil y répond pour trois boutons d'un
     * coup — jouer, défier, s'abonner — et il ne peut pas le faire en trois
     * allers-retours.
     */
    canDuel: Boolean(user.is_subscriber || user.is_premium) || duelTrialState(user).remaining > 0,
    duelTrial: duelTrialState(user),
    isPremium: Boolean(user.is_premium),
    // Abonné sans abonnement : administrateur, ou geste accordé à la main.
    // Il n'y a rien à résilier et aucune échéance à afficher — le profil doit
    // le dire au lieu d'inventer une « formule mensuelle ».
    manual: Boolean(user.is_subscriber || user.is_premium) && !user.subscription_id,
    plan: user.subscription_plan || null,
    // Le libellé, pour que le profil dise « Illimité » et non « unlimited ».
    planLabel: PLANS[user.subscription_plan]?.label || null,
    // Le portefeuille voyage avec l'abonnement : c'est la même question côté
    // joueur (« qu'est-ce que je peux faire aujourd'hui ? »), ça n'a pas à
    // demander un second aller-retour.
    credits: creditSummary(user.id),
    status: user.subscription_status || null,
    premiumUntil: user.premium_until || null,
    // Un abonnement résilié reste actif jusqu'à l'échéance : le client doit
    // pouvoir dire « premium jusqu'au … » plutôt que « abonné ».
    cancelled: user.subscription_status === 'CANCELLED',
    provider: user.subscription_provider || null,
  };
}
