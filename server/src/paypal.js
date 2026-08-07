import { config } from './config.js';

/**
 * Client REST PayPal.
 *
 * Aucune dépendance : Node 22 fournit `fetch` nativement. Le SDK officiel
 * n'apporterait rien ici, on n'utilise que cinq points d'entrée.
 *
 * Deux environnements totalement séparés chez PayPal : les identifiants
 * « sandbox » ne fonctionnent pas en « live » et inversement. Les plans
 * d'abonnement doivent donc être créés une fois dans chaque environnement
 * (voir `npm run paypal:setup`).
 */

const HOSTS = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
};

export const paypalHost = () => HOSTS[config.paypal.environment] || HOSTS.sandbox;

/**
 * PayPal est-il configuré ? Sans cela, tout le module d'abonnement reste muet.
 *
 * On exige au moins UN plan, pas les deux : si seul l'Illimité est déclaré,
 * PayPal doit pouvoir le vendre plutôt que de disparaître entièrement. Chaque
 * formule vérifie ensuite son propre identifiant avant d'ouvrir un paiement.
 */
export const paypalEnabled = Boolean(
  config.paypal.clientId &&
    config.paypal.clientSecret &&
    (config.paypal.plans.access || config.paypal.plans.unlimited)
);

/* ------------------------------------------------------------------ *
 *  Jeton d'accès — valable ~9 h, on le garde en mémoire avec une marge.
 * ------------------------------------------------------------------ */

let cachedToken = null;

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const basic = Buffer.from(
    `${config.paypal.clientId}:${config.paypal.clientSecret}`
  ).toString('base64');

  const res = await fetch(`${paypalHost()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    throw new Error(`PayPal : authentification refusée (${res.status} ${await res.text()})`);
  }

  const data = await res.json();
  cachedToken = {
    value: data.access_token,
    // On expire 60 s plus tôt que PayPal pour ne jamais présenter un jeton mort.
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

/** Appel authentifié à l'API PayPal. Lève une erreur lisible en cas d'échec. */
export async function paypalRequest(method, path, body, extraHeaders = {}) {
  const token = await accessToken();

  const res = await fetch(`${paypalHost()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const detail = data?.details?.[0]?.description || data?.message || text;
    const err = new Error(`PayPal ${method} ${path} → ${res.status} : ${detail}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }

  return data;
}

/* ------------------------------------------------------------------ *
 *  Abonnements
 * ------------------------------------------------------------------ */

/**
 * Crée un abonnement en attente d'approbation et renvoie le lien vers
 * lequel envoyer le joueur. `custom_id` porte l'identifiant du compte :
 * c'est ce qui nous permet, au retour, de savoir qui a payé.
 */
export async function createSubscription({ planId, userId, email, returnUrl, cancelUrl }) {
  const sub = await paypalRequest('POST', '/v1/billing/subscriptions', {
    plan_id: planId,
    custom_id: userId,
    subscriber: email ? { email_address: email } : undefined,
    application_context: {
      brand_name: 'Suis-je un footix ?',
      locale: 'fr-FR',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'SUBSCRIBE_NOW',
      payment_method: { payer_selected: 'PAYPAL', payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED' },
      return_url: returnUrl,
      cancel_url: cancelUrl,
    },
  });

  const approve = (sub.links || []).find((l) => l.rel === 'approve');
  if (!approve) throw new Error("PayPal n'a pas renvoyé de lien d'approbation.");

  return { id: sub.id, status: sub.status, approveUrl: approve.href };
}

export function getSubscription(subscriptionId) {
  return paypalRequest('GET', `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

/**
 * Change la formule d'un abonnement existant.
 *
 * PayPal appelle ça « réviser », et c'est exactement ce qu'il faut faire :
 * ouvrir un second abonnement pour monter en gamme laisserait le premier
 * courir, et le joueur serait prélevé deux fois chaque mois. Ici la ligne
 * change, il n'y en a jamais deux.
 *
 * Une révision doit être approuvée par le payeur — c'est son argent qui
 * augmente — d'où le lien de retour. PayPal ajuste le prorata lui-même.
 */
export async function reviseSubscription({ subscriptionId, planId, returnUrl, cancelUrl }) {
  const revision = await paypalRequest(
    'POST',
    `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/revise`,
    {
      plan_id: planId,
      application_context: {
        brand_name: 'Suis-je un footix ?',
        locale: 'fr-FR',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    }
  );

  const approve = (revision.links || []).find((l) => l.rel === 'approve');
  if (!approve) throw new Error("PayPal n'a pas renvoyé de lien d'approbation.");

  return { approveUrl: approve.href };
}

export function cancelSubscription(subscriptionId, reason = 'Résiliation demandée par le joueur.') {
  return paypalRequest(
    'POST',
    `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    { reason }
  );
}

/* ------------------------------------------------------------------ *
 *  Dons — commandes ponctuelles
 * ------------------------------------------------------------------ */

/**
 * Ouvre une commande et renvoie le lien de paiement.
 *
 * Contrairement aux abonnements, on ne restreint pas le moyen de paiement :
 * PayPal propose alors aussi la carte bancaire sans compte, ce qui compte
 * pour un don — beaucoup de gens n'ont pas de compte PayPal.
 *
 * Le bénéficiaire n'est pas transmis : l'argent va au compte propriétaire
 * des identifiants d'API. Aucune adresse e-mail ne circule.
 */
export async function createDonationOrder({ amount, currency = 'EUR', returnUrl, cancelUrl }) {
  const order = await paypalRequest('POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [
      {
        amount: { currency_code: currency, value: amount },
        description: 'Soutien au jeu Suis-je un footix ?',
      },
    ],
    application_context: {
      brand_name: 'Suis-je un footix ?',
      locale: 'fr-FR',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
      return_url: returnUrl,
      cancel_url: cancelUrl,
    },
  });

  const approve = (order.links || []).find((l) => l.rel === 'approve');
  if (!approve) throw new Error("PayPal n'a pas renvoyé de lien de paiement.");

  return { id: order.id, status: order.status, approveUrl: approve.href };
}

export function getOrder(orderId) {
  return paypalRequest('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

export function captureOrder(orderId) {
  return paypalRequest('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {});
}

/* ------------------------------------------------------------------ *
 *  Vérification des webhooks
 * ------------------------------------------------------------------ */

/**
 * Un webhook non vérifié est une porte ouverte : n'importe qui pourrait
 * appeler la route et s'offrir le premium. PayPal ne signe pas comme
 * Stripe — il faut lui redemander de valider la signature, en lui
 * renvoyant le corps de la requête *tel quel*.
 */
export async function verifyWebhookSignature(headers, rawBody) {
  if (!config.paypal.webhookId) return false;

  const required = [
    'paypal-auth-algo',
    'paypal-cert-url',
    'paypal-transmission-id',
    'paypal-transmission-sig',
    'paypal-transmission-time',
  ];
  if (required.some((h) => !headers[h])) return false;

  const result = await paypalRequest('POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: config.paypal.webhookId,
    // PayPal exige l'événement en objet, mais recalcule la signature sur la
    // sérialisation exacte : on repart du corps brut pour ne rien altérer.
    webhook_event: JSON.parse(rawBody.toString('utf8')),
  });

  return result?.verification_status === 'SUCCESS';
}
