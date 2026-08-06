import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import {
  PLANS,
  alreadyProcessed,
  applyStripeSubscription,
  billingSummary,
  markProcessed,
} from '../billing.js';
import {
  cancelSubscriptionAtPeriodEnd,
  createCheckoutSession,
  createDonationSession,
  getCheckoutSession,
  getSubscription,
  stripeAuthState,
  stripeEnabled,
  stripeIsLive,
  stripeUsable,
  verifyWebhookSignature,
} from '../stripe.js';

export const stripeRouter = Router();

/**
 * Paiement par carte, via Stripe Checkout.
 *
 * Stripe héberge la page de paiement : nous ne voyons jamais un numéro de
 * carte, et il n'y a donc rien à sécuriser de ce côté. Le serveur ouvre une
 * session, le joueur y est envoyé, et le webhook fait foi au retour.
 */

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

/**
 * Le message quand la carte n'est pas ouverte.
 *
 * Deux causes, deux phrases : rien n'a jamais été branché, ou la clé vient
 * d'être refusée. Dans le second cas on renvoie vers PayPal — le joueur
 * voulait donner, il ne doit pas repartir les mains vides à cause d'une
 * variable d'environnement.
 */
function indisponible() {
  return stripeEnabled
    ? 'Le paiement par carte est momentanément indisponible. PayPal fonctionne normalement.'
    : "Le paiement par carte n'est pas encore ouvert.";
}

/** Retrouve la clé de formule à partir d'un identifiant de prix Stripe. */
function planPourPrix(priceId) {
  if (priceId && priceId === config.stripe.prices.monthly) return 'monthly';
  if (priceId && priceId === config.stripe.prices.yearly) return 'yearly';
  return null;
}

/* -------------------------------------------------------------- *
 *  POST /api/stripe/subscribe — ouvre une session d'abonnement
 * -------------------------------------------------------------- */

stripeRouter.post('/subscribe', requireAuth, limiter, async (req, res) => {
  if (!stripeUsable()) {
    return res.status(503).json({ error: indisponible() });
  }
  if (req.user.is_premium) {
    return res.status(409).json({ error: 'Tu es déjà abonné.' });
  }

  const plan = PLANS[req.body?.plan];
  if (!plan) return res.status(400).json({ error: 'Formule inconnue.' });

  const priceId = config.stripe.prices[plan.key];
  if (!priceId) return res.status(503).json({ error: 'Cette formule est indisponible.' });

  try {
    const { url } = await createCheckoutSession({
      priceId,
      userId: req.user.id,
      email: req.user.email,
      successUrl: `${config.publicUrl}/premium/merci`,
      cancelUrl: `${config.publicUrl}/premium?annule=1`,
    });

    db.prepare('UPDATE users SET subscription_plan = ? WHERE id = ?').run(plan.key, req.user.id);
    res.json({ url });
  } catch (err) {
    console.error('[stripe] session d’abonnement :', err.message);
    if (!stripeUsable()) return res.status(503).json({ error: indisponible() });
    res.status(502).json({ error: "Stripe n'a pas pu ouvrir le paiement. Réessaie." });
  }
});

/* -------------------------------------------------------------- *
 *  POST /api/stripe/confirm — au retour de Stripe
 *
 *  Le webhook fait foi mais peut avoir quelques secondes de retard :
 *  cette route ouvre les droits tout de suite, sans jamais faire
 *  confiance au client (on interroge Stripe nous-mêmes).
 * -------------------------------------------------------------- */

stripeRouter.post('/confirm', requireAuth, limiter, async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim();
  if (!sessionId) return res.status(400).json({ error: 'Session manquante.' });

  try {
    const session = await getCheckoutSession(sessionId);

    // Garde-fou : la session doit bien appartenir au compte qui la réclame.
    if (session.client_reference_id && session.client_reference_id !== req.user.id) {
      return res.status(403).json({ error: 'Cette session appartient à un autre compte.' });
    }
    if (session.payment_status !== 'paid' || !session.subscription) {
      return res.status(409).json({ error: "Le paiement n'est pas finalisé." });
    }

    const subscription = await getSubscription(session.subscription);
    applyStripeSubscription(
      req.user.id,
      subscription,
      planPourPrix(subscription.items?.data?.[0]?.price?.id)
    );

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json(billingSummary(user));
  } catch (err) {
    console.error('[stripe] confirmation :', err.message);
    res.status(502).json({ error: "Impossible de vérifier le paiement auprès de Stripe." });
  }
});

/* -------------------------------------------------------------- *
 *  POST /api/stripe/cancel — résiliation
 * -------------------------------------------------------------- */

stripeRouter.post('/cancel', requireAuth, limiter, async (req, res) => {
  if (req.user.subscription_provider !== 'stripe' || !req.user.subscription_id) {
    return res.status(400).json({ error: 'Aucun abonnement Stripe en cours.' });
  }

  try {
    // Résiliation à l'échéance, jamais immédiate : la période est payée.
    const subscription = await cancelSubscriptionAtPeriodEnd(req.user.subscription_id);
    applyStripeSubscription(req.user.id, subscription);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({
      ...billingSummary(user),
      message: 'Abonnement résilié. Tes avantages restent actifs jusqu’à la fin de la période payée.',
    });
  } catch (err) {
    console.error('[stripe] résiliation :', err.message);
    res.status(502).json({ error: 'La résiliation a échoué. Réessaie.' });
  }
});

/* -------------------------------------------------------------- *
 *  POST /api/stripe/donate — don ponctuel par carte
 * -------------------------------------------------------------- */

stripeRouter.post('/donate', limiter, async (req, res) => {
  if (!stripeUsable()) {
    return res.status(503).json({ error: indisponible() });
  }

  const n = Number(req.body?.amount);
  const montant = Number.isFinite(n) ? Math.round(n * 100) : NaN;
  if (
    !Number.isFinite(montant) ||
    montant < config.donations.min * 100 ||
    montant > config.donations.max * 100
  ) {
    return res.status(400).json({
      error: `Montant invalide : entre ${config.donations.min} et ${config.donations.max} €.`,
    });
  }

  try {
    const { id, url } = await createDonationSession({
      amountCents: montant,
      successUrl: `${config.publicUrl}/soutenir/merci`,
      cancelUrl: `${config.publicUrl}/soutenir?annule=1`,
    });

    // Même table que les dons PayPal : la session Stripe sert de référence.
    db.prepare(
      'INSERT INTO donations (order_id, amount, status) VALUES (?, ?, ?)'
    ).run(id, (montant / 100).toFixed(2), 'CREATED');

    res.json({ orderId: id, url });
  } catch (err) {
    console.error('[stripe] session de don :', err.message);
    // Si c'est la clé qui vient d'être refusée, « réessaie » serait un
    // mensonge : le prochain essai échouera pareil.
    if (!stripeUsable()) return res.status(503).json({ error: indisponible() });
    res.status(502).json({ error: "Stripe n'a pas pu ouvrir le paiement. Réessaie." });
  }
});

/* -------------------------------------------------------------- *
 *  POST /api/stripe/donate/confirm — au retour de Stripe
 *
 *  Même rôle que /api/donate/capture côté PayPal : le webhook fait foi
 *  mais peut avoir quelques secondes de retard, et le donateur, lui, est
 *  déjà revenu sur la page de remerciement. On interroge Stripe
 *  nous-mêmes — jamais le client, qui pourrait inventer n'importe quoi.
 * -------------------------------------------------------------- */

stripeRouter.post('/donate/confirm', limiter, async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim();
  if (!sessionId) return res.status(400).json({ error: 'Session manquante.' });

  // La session doit venir de chez nous : on refuse d'entériner une
  // référence arbitraire fournie par le navigateur.
  const connu = db.prepare('SELECT * FROM donations WHERE order_id = ?').get(sessionId);
  if (!connu) return res.status(404).json({ error: 'Paiement inconnu.' });

  // Rechargement de la page de retour, ou webhook déjà passé : on ne
  // rejoue rien.
  if (connu.status === 'COMPLETED') {
    return res.json({
      status: 'COMPLETED',
      amount: connu.amount,
      currency: connu.currency,
      orderId: sessionId,
    });
  }

  try {
    const session = await getCheckoutSession(sessionId);
    if (session.payment_status !== 'paid') {
      return res.status(409).json({ error: "Le paiement n'est pas finalisé." });
    }

    db.prepare(
      "UPDATE donations SET status = 'COMPLETED', captured_at = datetime('now') WHERE order_id = ?"
    ).run(sessionId);

    res.json({
      status: 'COMPLETED',
      amount: connu.amount,
      currency: connu.currency,
      orderId: sessionId,
    });
  } catch (err) {
    console.error('[stripe] confirmation de don :', err.message);
    res.status(502).json({ error: 'Impossible de vérifier le paiement auprès de Stripe.' });
  }
});

/* -------------------------------------------------------------- *
 *  Webhook Stripe
 *
 *  Monté à part dans index.js, AVANT express.json() : la signature se
 *  vérifie sur le corps brut.
 * -------------------------------------------------------------- */

export async function stripeWebhook(req, res) {
  if (!verifyWebhookSignature(req.headers['stripe-signature'], req.body)) {
    console.warn('[stripe] webhook refusé (signature invalide)');
    return res.status(401).send('signature invalide');
  }

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).send('corps illisible');
  }

  // Stripe réessaie pendant 3 jours : on répond 200 sur un événement déjà
  // traité ou hors périmètre, sinon il insiste pour rien.
  if (alreadyProcessed(event.id)) return res.status(200).send('déjà traité');

  const objet = event.data?.object || {};

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        // Don ponctuel : on marque l'encaissement, rien d'autre à faire.
        if (objet.mode === 'payment') {
          db.prepare(
            "UPDATE donations SET status = 'COMPLETED', captured_at = datetime('now') WHERE order_id = ?"
          ).run(objet.id);
          break;
        }
        // Abonnement : le compte vient du client_reference_id.
        if (objet.subscription && objet.client_reference_id) {
          const sub = await getSubscription(objet.subscription);
          applyStripeSubscription(
            objet.client_reference_id,
            sub,
            planPourPrix(sub.items?.data?.[0]?.price?.id)
          );
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed': {
        // Ces événements ne portent pas toujours l'abonnement complet :
        // on le recharge plutôt que de deviner.
        const subId = objet.subscription || objet.id;
        if (!subId) break;

        const sub = await getSubscription(subId);
        const userId = sub.metadata?.userId
          || db.prepare('SELECT id FROM users WHERE subscription_id = ?').get(subId)?.id;

        if (!userId) {
          console.warn(`[stripe] webhook sans compte associé : ${event.type} / ${subId}`);
          break;
        }
        applyStripeSubscription(userId, sub);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(`[stripe] traitement ${event.type} :`, err.message);
    // Rien n'est marqué : Stripe réessaiera et l'événement ne sera pas écarté.
    return res.status(500).send('traitement en échec');
  }

  markProcessed(event.id, event.type, null, event);
  res.status(200).send('ok');
}

/* -------------------------------------------------------------- *
 *  GET /api/stripe/status — état de la configuration
 * -------------------------------------------------------------- */

stripeRouter.get('/status', (req, res) => {
  const auth = stripeAuthState();
  res.json({
    // `enabled` reste ce qu'il a toujours dit : une clé est configurée.
    enabled: stripeEnabled,
    // `usable` dit si elle répond encore. C'est la ligne à regarder quand
    // le bouton carte a disparu du site sans qu'on ait rien changé.
    usable: auth.usable,
    rejectedSince: auth.rejectedSince,
    live: stripeEnabled && stripeIsLive,
    plans: {
      monthly: Boolean(config.stripe.prices.monthly),
      yearly: Boolean(config.stripe.prices.yearly),
    },
  });
});
