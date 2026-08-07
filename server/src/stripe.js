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

/* ------------------------------------------------------------------ *
 *  Clé refusée : Stripe se coupe tout seul
 *
 *  Une clé peut mourir en cours de route — renouvelée dans le tableau de
 *  bord, révoquée, ou simplement mal recopiée dans les variables. Stripe
 *  répond alors 401 à chaque appel, et le joueur, lui, voit un bouton bien
 *  visible qui mène à un carré rouge. Il essaie deux fois, puis il s'en va :
 *  on a perdu un don, et on ne l'apprend que par les logs.
 *
 *  Dès le premier refus d'authentification, on retient l'information : les
 *  routes cessent d'ouvrir des paiements et surtout `/api/donate/options`
 *  cesse d'annoncer la carte, si bien que le bouton disparaît de lui-même et
 *  que PayPal reprend la place. Mieux vaut un moyen de paiement en moins
 *  qu'un moyen de paiement qui échoue.
 *
 *  L'oubli est automatique : le premier appel qui repasse remet le compteur
 *  à zéro. En pratique c'est le redémarrage qui suit la correction de la
 *  variable, mais rien n'oblige à redémarrer si la clé revient d'elle-même.
 * ------------------------------------------------------------------ */

let refusDepuis = null;

/*
 * Combien de temps on garde la carte fermée après un refus.
 *
 * La première version verrouillait jusqu'au redémarrage. Trop brutal, et pour
 * une raison qui compte : UN seul 401 — passager, ou une réponse bizarre de
 * Stripe un mauvais jour — suffisait à couper le paiement par carte pendant
 * des heures, en silence, sans que personne ne s'en aperçoive avant le
 * prochain déploiement. Le remède devenait pire que le mal qu'il soignait.
 *
 * Deux minutes suffisent à éviter d'afficher un bouton mort en boucle. Passé
 * ce délai, on retente pour de vrai : si la clé est réellement morte, le refus
 * revient immédiatement et le bouton disparaît de nouveau ; si c'était un
 * hoquet, la boutique rouvre toute seule.
 */
const OUBLI_MS = 2 * 60_000;

/**
 * Stripe est-il configuré ET en état de répondre ?
 *
 * Effet de bord assumé : au-delà du délai d'oubli, l'appel efface le refus
 * pour qu'un vrai essai reparte. C'est ce qui rend la panne auto-réparable.
 */
export function stripeUsable() {
  if (!stripeEnabled) return false;
  if (!refusDepuis) return true;

  if (Date.now() - refusDepuis > OUBLI_MS) {
    console.log('[stripe] nouvelle tentative après refus — la carte est réouverte à l’essai.');
    refusDepuis = null;
    return true;
  }
  return false;
}

/** État détaillé, pour le tableau de bord et la route /status. */
export function stripeAuthState() {
  return {
    configured: stripeEnabled,
    usable: stripeUsable(),
    rejectedSince: refusDepuis ? new Date(refusDepuis).toISOString() : null,
  };
}

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

    /*
     * 401 = la clé elle-même est refusée (expirée, révoquée, mal recopiée).
     * C'est la seule erreur qui condamne TOUS les appels suivants : un 400
     * ou un 402 ne concerne que la requête en cours, et couper Stripe pour
     * un montant invalide serait absurde.
     */
    if (res.status === 401) {
      refusDepuis = Date.now();
      console.error(
        `[stripe] CLE REFUSEE sur ${method} ${path} (${detail}) — paiement par carte ` +
          `suspendu 2 min, puis nouvel essai. Si ca se repete, corrige ` +
          `STRIPE_SECRET_KEY chez l'hebergeur.`
      );
    }

    const err = new Error(`Stripe ${method} ${path} → ${detail}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }

  // Un appel qui aboutit prouve que la clé vaut de nouveau quelque chose.
  if (refusDepuis) {
    console.log('[stripe] la clé répond de nouveau — paiement par carte réactivé.');
    refusDepuis = null;
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

/**
 * Change la formule d'un abonnement en cours.
 *
 * C'est le chemin de la montée en gamme, et il ne doit surtout PAS passer
 * par une seconde page de paiement : celle-ci ouvrirait un deuxième
 * abonnement à côté du premier, et le joueur serait prélevé deux fois tous
 * les mois sans jamais comprendre pourquoi. On modifie la ligne existante.
 *
 * `proration_behavior: 'always_invoice'` facture immédiatement la
 * différence, au prorata des jours restants. C'est le comportement qu'on
 * attend d'un changement de formule : on paie ce qu'on prend, tout de suite,
 * et l'échéance suivante ne bouge pas.
 *
 * `cancel_at_period_end: false` relance au passage un abonnement résilié
 * mais encore courant : choisir une formule, c'est vouloir rester.
 */
export async function changeSubscriptionPrice(subscriptionId, priceId) {
  const subscription = await getSubscription(subscriptionId);
  const item = subscription?.items?.data?.[0];
  if (!item) throw new Error('Abonnement Stripe sans ligne de facturation.');

  return stripeRequest('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    items: [{ id: item.id, price: priceId }],
    proration_behavior: 'always_invoice',
    cancel_at_period_end: false,
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
 *  Recharges — des parties achetées à l'unité
 * ------------------------------------------------------------------ */

/**
 * Ouvre le paiement d'une recharge de parties.
 *
 * Un paiement PONCTUEL, pas un abonnement : on achète un lot de parties une
 * fois, on ne s'engage à rien. C'est ce qu'attend quelqu'un dont le stock
 * est vide un mardi soir et qui veut juste rejouer maintenant.
 *
 * `metadata` porte le compte et le lot. C'est ce que le webhook relira pour
 * savoir qui créditer et de combien : on ne fait jamais confiance à ce que
 * le navigateur renvoie au retour, seul Stripe fait foi.
 *
 * L'identifiant de session sert de référence au crédit, ce qui rend
 * l'opération sûre à rejouer — Stripe réémet ses événements, et créditer
 * deux fois un paiement unique se remarquerait du mauvais côté du compte.
 */
export async function createCreditPackSession({
  pack,
  credits,
  amountCents,
  userId,
  email,
  successUrl,
  cancelUrl,
}) {
  const session = await stripeRequest('POST', '/checkout/sessions', {
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: amountCents,
          product_data: {
            name: `${credits} parties — Suis-je un footix ?`,
            description: 'Parties supplémentaires, sans engagement. Elles ne périment pas.',
          },
        },
      },
    ],
    client_reference_id: userId,
    customer_email: email || undefined,
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    locale: 'fr',
    metadata: { userId, pack, credits: String(credits), kind: 'credits' },
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
