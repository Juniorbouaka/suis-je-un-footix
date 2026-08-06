import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Client REST Stripe.
 *
 * Aucune dépendance, comme pour PayPal : l'API Stripe est du HTTP simple en
 * `application/x-www-form-urlencoded`, et la vérification de signature tient
 * en quelques lignes avec `node:crypto`. Le SDK officiel apporterait surtout
 * du poids pour les cinq points d'entrée qu'on utilise.
 *
 * Stripe n'a pas deux mondes séparés comme PayPal : c'est la clé elle-même
 * qui décide. `sk_test_…` ne touche à rien de réel, `sk_live_…` encaisse.
 */

const API = 'https://api.stripe.com/v1';

export const stripeEnabled = Boolean(config.stripe.secretKey);

/** La clé est-elle une clé de test ? Sert à l'affichage et aux garde-fous. */
export const stripeIsLive = config.stripe.secretKey.startsWith('sk_live_');

/**
 * Aplatit un objet en paramètres de formulaire à la mode Stripe :
 * { a: { b: 1 }, c: [{ d: 2 }] } devient a[b]=1&c[0][d]=2
 */
function encoder(objet, prefixe = '', sortie = []) {
  for (const [cle, valeur] of Object.entries(objet)) {
    if (valeur === undefined || valeur === null) continue;
    const nom = prefixe ? `${prefixe}[${cle}]` : cle;

    if (Array.isArray(valeur)) {
      valeur.forEach((v, i) =>
        typeof v === 'object'
          ? encoder(v, `${nom}[${i}]`, sortie)
          : sortie.push([`${nom}[${i}]`, String(v)])
      );
    } else if (typeof valeur === 'object') {
      encoder(valeur, nom, sortie);
    } else {
      sortie.push([nom, String(valeur)]);
    }
  }
  return sortie;
}

/** Appel authentifié à l'API Stripe. Lève une erreur lisible en cas d'échec. */
export async function stripeRequest(method, path, corps, entetes = {}) {
  if (!stripeEnabled) throw new Error('Stripe n’est pas configuré.');

  const body = corps
    ? new URLSearchParams(encoder(corps)).toString()
    : undefined;

  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.stripe.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...entetes,
    },
    body,
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const detail = data?.error?.message || `HTTP ${res.status}`;
    const err = new Error(`Stripe ${method} ${path} → ${detail}`);
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
 * Ouvre une session de paiement hébergée par Stripe.
 *
 * `client_reference_id` porte l'identifiant du compte : c'est ce qui nous
 * permet, au retour comme au webhook, de savoir qui a payé. `customer_email`
 * évite au joueur de ressaisir son adresse.
 */
export async function createCheckoutSession({ priceId, userId, email, successUrl, cancelUrl }) {
  const session = await stripeRequest('POST', '/checkout/sessions', {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: userId,
    customer_email: email || undefined,
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    locale: 'fr',
    // Rattache l'identifiant au dessous de la session : le webhook
    // d'abonnement ne voit pas client_reference_id, seulement les métadonnées.
    subscription_data: { metadata: { userId } },
    metadata: { userId },
  });

  return { id: session.id, url: session.url };
}

export function getCheckoutSession(sessionId) {
  return stripeRequest('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

export function getSubscription(subscriptionId) {
  return stripeRequest('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

/** Résilie à la fin de la période payée, jamais sur le champ. */
export function cancelSubscriptionAtPeriodEnd(subscriptionId) {
  return stripeRequest('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    cancel_at_period_end: true,
  });
}

/* ------------------------------------------------------------------ *
 *  Dons — paiement ponctuel
 * ------------------------------------------------------------------ */

/**
 * Ouvre une session de don.
 *
 * Aucun `payment_method_types` n'est imposé : laissé vide, Stripe applique
 * les moyens de paiement activés dans le tableau de bord et affiche Apple
 * Pay et Google Pay en boutons express, tout en haut de la page, dès que le
 * navigateur les propose. C'est le chemin le plus court sur téléphone —
 * deux secondes et une empreinte digitale, sans saisir seize chiffres.
 *
 * Rien à héberger ni à déclarer de notre côté : le domaine Apple Pay est
 * celui de Stripe, puisque la page de paiement est la sienne.
 *
 * `submit_type: 'donate'` change le libellé du bouton final en « Faire un
 * don » plutôt qu'« Payer » : c'est un don, pas un achat.
 */
export async function createDonationSession({ amountCents, successUrl, cancelUrl }) {
  const session = await stripeRequest('POST', '/checkout/sessions', {
    mode: 'payment',
    submit_type: 'donate',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: amountCents,
          product_data: { name: 'Soutien au jeu Suis-je un footix ?' },
        },
      },
    ],
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    locale: 'fr',
  });

  return { id: session.id, url: session.url };
}

/* ------------------------------------------------------------------ *
 *  Vérification des webhooks
 * ------------------------------------------------------------------ */

/**
 * Vérifie la signature d'un webhook Stripe.
 *
 * Stripe signe `timestamp.corps` en HMAC-SHA256 avec le secret du point de
 * terminaison, et transmet le tout dans l'en-tête `Stripe-Signature` sous la
 * forme `t=…,v1=…`. Un webhook non vérifié est une porte ouverte : n'importe
 * qui pourrait s'offrir le premium en appelant la route.
 *
 * La comparaison est à temps constant, et l'horodatage est contrôlé pour
 * qu'un ancien appel capturé ne puisse pas être rejoué indéfiniment.
 */
export function verifyWebhookSignature(entete, rawBody, toleranceSecondes = 300) {
  if (!config.stripe.webhookSecret || !entete) return false;

  const parts = Object.fromEntries(
    String(entete)
      .split(',')
      .map((p) => p.split('=').map((x) => x.trim()))
      .filter((p) => p.length === 2)
  );

  const timestamp = Number(parts.t);
  const fournie = parts.v1;
  if (!Number.isFinite(timestamp) || !fournie) return false;

  const age = Math.abs(Date.now() / 1000 - timestamp);
  if (age > toleranceSecondes) return false;

  const attendue = crypto
    .createHmac('sha256', config.stripe.webhookSecret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');

  const a = Buffer.from(attendue, 'utf8');
  const b = Buffer.from(fournie, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
