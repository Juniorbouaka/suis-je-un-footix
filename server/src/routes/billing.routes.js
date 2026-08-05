import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { db } from '../db.js';
import {
  PLANS,
  alreadyProcessed,
  applySubscription,
  billingSummary,
  markProcessed,
  syncSubscription,
  userIdForSubscription,
} from '../billing.js';
import {
  cancelSubscription,
  createSubscription,
  getSubscription,
  paypalEnabled,
  verifyWebhookSignature,
} from '../paypal.js';

export const billingRouter = Router();

/* Créer un abonnement coûte un appel API : on borne, comme ailleurs. */
const billingLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

/* -------------------------------------------------------------- *
 *  GET /api/billing/offer — l'offre, publique
 * -------------------------------------------------------------- */

billingRouter.get('/offer', (req, res) => {
  res.json({
    enabled: paypalEnabled,
    currency: config.premium.currency,
    donateUrl: config.donateUrl || null,
    plans: Object.values(PLANS).map((p) => ({
      key: p.key,
      label: p.label,
      price: p.price,
      period: p.period,
      available: Boolean(p.planId()),
    })),
  });
});

/* -------------------------------------------------------------- *
 *  GET /api/billing/status — l'abonnement du joueur connecté
 * -------------------------------------------------------------- */

billingRouter.get('/status', requireAuth, (req, res) => {
  res.json(billingSummary(req.user));
});

/* -------------------------------------------------------------- *
 *  POST /api/billing/subscribe — ouvre un abonnement chez PayPal
 *  Renvoie l'URL d'approbation vers laquelle envoyer le joueur.
 * -------------------------------------------------------------- */

billingRouter.post('/subscribe', requireAuth, billingLimiter, async (req, res) => {
  if (!paypalEnabled) {
    return res.status(503).json({ error: "L'abonnement n'est pas encore ouvert." });
  }
  if (req.user.is_premium) {
    return res.status(409).json({ error: 'Tu es déjà abonné.' });
  }

  const plan = PLANS[req.body?.plan];
  if (!plan) return res.status(400).json({ error: 'Formule inconnue.' });

  const planId = plan.planId();
  if (!planId) return res.status(503).json({ error: 'Cette formule est indisponible.' });

  try {
    const { id, approveUrl } = await createSubscription({
      planId,
      userId: req.user.id,
      email: req.user.email,
      returnUrl: `${config.publicUrl}/premium/merci`,
      cancelUrl: `${config.publicUrl}/premium?annule=1`,
    });

    // On mémorise la formule choisie dès maintenant : au retour, PayPal ne
    // renvoie que l'identifiant du plan, pas notre clé interne.
    db.prepare('UPDATE users SET subscription_plan = ? WHERE id = ?').run(plan.key, req.user.id);

    res.json({ subscriptionId: id, approveUrl });
  } catch (err) {
    console.error('[billing] création abonnement :', err.message);
    res.status(502).json({ error: "PayPal n'a pas pu ouvrir l'abonnement. Réessaie." });
  }
});

/* -------------------------------------------------------------- *
 *  POST /api/billing/confirm — au retour de PayPal
 *
 *  Le webhook fait foi, mais il peut arriver avec quelques secondes de
 *  retard : cette route donne au joueur ses droits immédiatement, sans
 *  jamais faire confiance au client (on interroge PayPal nous-mêmes).
 * -------------------------------------------------------------- */

billingRouter.post('/confirm', requireAuth, billingLimiter, async (req, res) => {
  const subscriptionId = String(req.body?.subscriptionId || '').trim();
  if (!subscriptionId) return res.status(400).json({ error: 'Abonnement manquant.' });

  try {
    await syncSubscription(req.user.id, subscriptionId, req.user.subscription_plan || null);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json(billingSummary(user));
  } catch (err) {
    if (err.status === 403) return res.status(403).json({ error: err.message });
    console.error('[billing] confirmation :', err.message);
    res.status(502).json({ error: "Impossible de vérifier l'abonnement auprès de PayPal." });
  }
});

/* -------------------------------------------------------------- *
 *  POST /api/billing/cancel — résiliation
 *  Les droits courent jusqu'à la fin de la période déjà payée.
 * -------------------------------------------------------------- */

billingRouter.post('/cancel', requireAuth, billingLimiter, async (req, res) => {
  if (!req.user.subscription_id) {
    return res.status(400).json({ error: 'Aucun abonnement en cours.' });
  }

  try {
    await cancelSubscription(req.user.subscription_id);
    const subscription = await getSubscription(req.user.subscription_id);
    applySubscription(req.user.id, subscription);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({
      ...billingSummary(user),
      message: 'Abonnement résilié. Tes avantages restent actifs jusqu’à la fin de la période payée.',
    });
  } catch (err) {
    console.error('[billing] résiliation :', err.message);
    res.status(502).json({ error: 'La résiliation a échoué. Réessaie ou passe par ton compte PayPal.' });
  }
});

/* -------------------------------------------------------------- *
 *  Webhook PayPal
 *
 *  Monté à part dans index.js, AVANT express.json() : la vérification de
 *  signature exige le corps brut, un JSON déjà analysé ne convient pas.
 * -------------------------------------------------------------- */

const SUBSCRIPTION_EVENTS = new Set([
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.UPDATED',
  'BILLING.SUBSCRIPTION.RE-ACTIVATED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.EXPIRED',
]);

export async function billingWebhook(req, res) {
  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).send('corps illisible');
  }

  let verified = false;
  try {
    verified = await verifyWebhookSignature(req.headers, req.body);
  } catch (err) {
    console.error('[billing] vérification webhook :', err.message);
  }

  if (!verified) {
    // Sans vérification, n'importe qui pourrait s'offrir le premium.
    console.warn(`[billing] webhook refusé (signature invalide) : ${event?.event_type}`);
    return res.status(401).send('signature invalide');
  }

  // PayPal réessaie jusqu'à 25 fois : on répond 200 même sur un événement
  // déjà vu ou hors périmètre, sinon il insiste pendant des jours.
  if (alreadyProcessed(event.id)) return res.status(200).send('déjà traité');

  const resource = event.resource || {};
  const subscriptionId = resource.id || resource.billing_agreement_id || null;
  const userId = userIdForSubscription(subscriptionId, resource.custom_id);

  if (!userId) {
    console.warn(`[billing] webhook sans compte associé : ${event.event_type} / ${subscriptionId}`);
    markProcessed(event.id, event.event_type, null, event);
    return res.status(200).send('compte inconnu');
  }

  try {
    if (SUBSCRIPTION_EVENTS.has(event.event_type)) {
      applySubscription(userId, resource);
    } else if (event.event_type === 'PAYMENT.SALE.COMPLETED' && subscriptionId) {
      // Renouvellement : on recharge l'abonnement pour récupérer la nouvelle
      // échéance plutôt que de la calculer nous-mêmes.
      const subscription = await getSubscription(subscriptionId);
      applySubscription(userId, subscription);
    }
  } catch (err) {
    console.error(`[billing] traitement ${event.event_type} :`, err.message);
    // Rien n'est marqué comme traité : PayPal réessaiera, et cette fois
    // l'événement ne sera pas écarté.
    return res.status(500).send('traitement en échec');
  }

  markProcessed(event.id, event.event_type, userId, event);
  res.status(200).send('ok');
}
