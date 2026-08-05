import { db } from './db.js';
import { applySubscription, applyStripeSubscription } from './billing.js';
import { getSubscription as getPaypalSubscription, paypalEnabled } from './paypal.js';
import { getSubscription as getStripeSubscription, stripeEnabled } from './stripe.js';

/**
 * Réconciliation des abonnements.
 *
 * Le webhook fait foi, mais il peut se perdre : réseau coupé, serveur en
 * redéploiement, panne du prestataire. Le pire scénario n'est pas qu'un
 * abonnement traîne — c'est qu'un client SOIT PRÉLEVÉ ET PERDE SES ACCÈS,
 * parce que le renouvellement n'a pas été enregistré et que l'échéance est
 * passée. Il paie et n'a plus rien.
 *
 * Ce module va donc rechercher, à intervalle régulier, les comptes dont
 * l'échéance approche ou vient de passer alors que l'abonnement est censé
 * être actif, et les recharge depuis le prestataire. C'est une ceinture,
 * pas un remplacement du webhook.
 */

const INTERVALLE_MS = 6 * 3600 * 1000; // toutes les 6 heures
const FENETRE_JOURS = 5; // on regarde jusqu'à 5 jours après l'échéance

/** Comptes à revérifier : échéance imminente ou tout juste dépassée. */
function candidats() {
  const borne = new Date(Date.now() + 2 * 86400_000).toISOString();
  const plancher = new Date(Date.now() - FENETRE_JOURS * 86400_000).toISOString();

  return db
    .prepare(
      `SELECT id, subscription_provider, subscription_id, subscription_status, premium_until
         FROM users
        WHERE subscription_id IS NOT NULL
          AND premium_until IS NOT NULL
          AND premium_until <= ?
          AND premium_until >= ?
          AND subscription_status NOT IN ('EXPIRED', 'CANCELLED_FINAL')`
    )
    .all(borne, plancher);
}

/** Recharge un abonnement depuis son prestataire. */
async function rafraichir(user) {
  if (user.subscription_provider === 'stripe') {
    if (!stripeEnabled) return false;
    const sub = await getStripeSubscription(user.subscription_id);
    applyStripeSubscription(user.id, sub);
    return true;
  }

  if (!paypalEnabled) return false;
  const sub = await getPaypalSubscription(user.subscription_id);
  applySubscription(user.id, sub);
  return true;
}

export async function runReconcile() {
  const liste = candidats();
  if (!liste.length) return { verifies: 0, echecs: 0 };

  let verifies = 0;
  let echecs = 0;

  for (const user of liste) {
    try {
      if (await rafraichir(user)) verifies += 1;
    } catch (err) {
      echecs += 1;
      // Un échec n'est pas anodin : il peut cacher un client qui paie sans
      // avoir ses droits. On le dit fort dans les logs.
      console.error(
        `[reconcile] ${user.subscription_provider} ${user.subscription_id} (compte ${user.id}) :`,
        err.message
      );
    }
  }

  console.log(`[reconcile] ${verifies} abonnement(s) rafraîchi(s), ${echecs} échec(s)`);
  return { verifies, echecs };
}

export function scheduleReconcile() {
  // Un premier passage peu après le démarrage rattrape ce qui a pu se
  // perdre pendant un redéploiement.
  setTimeout(() => {
    runReconcile().catch((err) => console.error('[reconcile]', err.message));
  }, 60_000).unref?.();

  const timer = setInterval(() => {
    runReconcile().catch((err) => console.error('[reconcile]', err.message));
  }, INTERVALLE_MS);

  timer.unref?.();
  return timer;
}
