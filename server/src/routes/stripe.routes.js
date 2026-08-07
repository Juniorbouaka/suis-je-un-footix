import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requirePaidAccess } from '../auth.js';
import {
  PLANS,
  alreadyProcessed,
  applyStripeSubscription,
  billingSummary,
  markProcessed,
} from '../billing.js';
import { creditSummary, grantPack } from '../credits.js';
import {
  cancelSubscriptionAtPeriodEnd,
  changeSubscriptionPrice,
  createCheckoutSession,
  createCreditPackSession,
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
function indisponible(ou) {
  /*
   * On TRACE le refus. La première version renvoyait ce 503 en silence : quand
   * un joueur a signalé « le paiement par carte est momentanément
   * indisponible », les logs ne contenaient rien du tout, et il était
   * impossible de distinguer un verrou fermé d'un appel Stripe en échec. Un
   * message d'erreur qui ne laisse pas de trace côté serveur est un message
   * qu'on ne pourra pas expliquer.
   */
  const etat = stripeAuthState();
  console.warn(
    `[stripe] refus sur ${ou} — configuree: ${etat.configured}, utilisable: ${etat.usable}` +
      (etat.rejectedSince ? `, cle refusee depuis ${etat.rejectedSince}` : '')
  );

  return stripeEnabled
    ? 'Le paiement par carte est momentanément indisponible. PayPal fonctionne normalement.'
    : "Le paiement par carte n'est pas encore ouvert.";
}

/**
 * Retrouve la clé de formule à partir d'un identifiant de prix Stripe.
 *
 * C'est ce qui décide, au webhook, si le joueur a pris l'Accès ou
 * l'Illimité. Renvoyer null n'est pas une erreur : la formule déjà
 * enregistrée sur le compte est alors conservée (voir writeRights).
 */
function planPourPrix(priceId) {
  if (!priceId) return null;
  return Object.keys(PLANS).find((cle) => priceId === config.stripe.prices[cle]) || null;
}

/* -------------------------------------------------------------- *
 *  POST /api/stripe/subscribe — ouvre une session d'abonnement
 * -------------------------------------------------------------- */

stripeRouter.post('/subscribe', requireAuth, limiter, async (req, res) => {
  if (!stripeUsable()) {
    return res.status(503).json({ error: indisponible('subscribe (verrou)') });
  }

  const plan = PLANS[req.body?.plan];
  if (!plan) return res.status(400).json({ error: 'Formule inconnue.' });

  const priceId = config.stripe.prices[plan.key];
  if (!priceId) return res.status(503).json({ error: 'Cette formule est indisponible.' });

  if (req.user.subscription_plan === plan.key && req.user.is_subscriber) {
    return res.status(409).json({ error: 'Tu as déjà cette formule.' });
  }

  /*
   * Changement de formule : on MODIFIE l'abonnement en cours, on n'en ouvre
   * pas un second.
   *
   * Une seconde page de paiement créerait un deuxième abonnement à côté du
   * premier — deux prélèvements tous les mois, et un joueur qui découvre la
   * chose sur son relevé bancaire. C'est le genre d'erreur dont on ne se
   * remet pas commercialement.
   *
   * Le nouveau stock de crédits est servi tout de suite : `applyStripe-
   * Subscription` voit la formule changer et appelle `grantOnPlanChange`.
   * Celui qui paie l'Illimité en cours de mois joue à l'Illimité le soir même.
   */
  const abonnementEnCours =
    req.user.is_subscriber &&
    req.user.subscription_provider === 'stripe' &&
    req.user.subscription_id;

  if (abonnementEnCours) {
    try {
      const subscription = await changeSubscriptionPrice(req.user.subscription_id, priceId);
      const etat = applyStripeSubscription(req.user.id, subscription, plan.key);
      return res.json({ changed: true, ...etat });
    } catch (err) {
      console.error('[stripe] changement de formule :', err.message);
      return res.status(502).json({
        error: "Stripe n'a pas pu changer ta formule. Réessaie dans un instant.",
      });
    }
  }

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
    if (!stripeUsable()) return res.status(503).json({ error: indisponible('subscribe (echec appel)') });
    res.status(502).json({ error: "Stripe n'a pas pu ouvrir le paiement. Réessaie." });
  }
});

/* -------------------------------------------------------------- *
 *  POST /api/stripe/credits — acheter une recharge de parties
 *
 *  Un paiement ponctuel, sans engagement, pour qui a vidé son stock et
 *  ne veut pas attendre l'échéance. Réservé aux abonnés : c'est un
 *  complément à l'abonnement, pas une façon de contourner l'entrée —
 *  vendre des parties à quelqu'un qui ne peut pas jouer serait lui
 *  vendre quelque chose d'inutilisable.
 * -------------------------------------------------------------- */

stripeRouter.post('/credits', requirePaidAccess, limiter, async (req, res) => {
  if (!stripeUsable()) {
    return res.status(503).json({ error: indisponible('credits (verrou)') });
  }

  const pack = config.credits.packs.find((p) => p.key === req.body?.pack);
  if (!pack) return res.status(400).json({ error: 'Recharge inconnue.' });

  try {
    const { url } = await createCreditPackSession({
      pack: pack.key,
      credits: pack.credits,
      amountCents: pack.cents,
      userId: req.user.id,
      email: req.user.email,
      successUrl: `${config.publicUrl}/premium/merci`,
      cancelUrl: `${config.publicUrl}/premium?annule=1`,
    });

    res.json({ url });
  } catch (err) {
    console.error('[stripe] session de recharge :', err.message);
    if (!stripeUsable()) return res.status(503).json({ error: indisponible('credits (echec appel)') });
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
    if (session.payment_status !== 'paid') {
      return res.status(409).json({ error: "Le paiement n'est pas finalisé." });
    }

    /*
     * Recharge de parties : on crédite ici aussi, sans attendre le webhook.
     *
     * Les deux chemins mènent au même `grantPack`, qui porte l'identifiant
     * de session en référence : celui des deux qui arrive en second ne
     * crédite rien. C'est exactement la redondance qu'on veut pour de
     * l'argent déjà encaissé — le joueur voit ses parties tout de suite, et
     * le webhook rattrape le cas où il ferme l'onglet avant le retour.
     */
    if (session.metadata?.kind === 'credits') {
      const credits = Number(session.metadata.credits);
      const res2 = grantPack(req.user.id, credits, `achat:${session.id}`);
      return res.json({
        credited: res2.credited,
        alreadyCredited: Boolean(res2.alreadyCredited),
        credits: creditSummary(req.user.id),
      });
    }

    if (!session.subscription) {
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
    return res.status(503).json({ error: indisponible('donate (verrou)') });
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
    if (!stripeUsable()) return res.status(503).json({ error: indisponible('donate (echec appel)') });
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
        if (objet.mode === 'payment') {
          /*
           * Deux paiements ponctuels partagent ce chemin, et il faut les
           * distinguer avant tout : une recharge de parties porte
           * `metadata.kind = 'credits'`, un don n'a pas de métadonnées.
           *
           * C'est le webhook qui crédite, jamais le retour du navigateur :
           * lui peut être fabriqué, rejoué, ou ne jamais arriver si le
           * joueur ferme l'onglet après avoir payé. `grantPack` porte
           * l'identifiant de session en référence et refuse de créditer
           * deux fois le même paiement.
           */
          if (objet.metadata?.kind === 'credits') {
            const userId = objet.metadata.userId || objet.client_reference_id;
            const credits = Number(objet.metadata.credits);

            if (!userId || !(credits > 0)) {
              console.warn(`[stripe] recharge sans compte ou sans quantité : ${objet.id}`);
              break;
            }

            const res = grantPack(userId, credits, `achat:${objet.id}`);
            console.log(
              `[stripe] recharge ${objet.id} : ${res.credited} parties creditees ` +
                `(solde ${res.balance})${res.alreadyCredited ? ' — deja traitee' : ''}`
            );
            break;
          }

          // Don ponctuel : on marque l'encaissement, rien d'autre à faire.
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
      access: Boolean(config.stripe.prices.access),
      unlimited: Boolean(config.stripe.prices.unlimited),
    },
  });
});
