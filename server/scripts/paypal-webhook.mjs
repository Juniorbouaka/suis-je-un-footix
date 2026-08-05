#!/usr/bin/env node
/**
 * Déclare le webhook d'abonnement chez PayPal et affiche son identifiant.
 *
 *   cd server && railway run node scripts/paypal-webhook.mjs
 *
 * L'URL est déduite de PUBLIC_URL : le webhook doit pointer vers le serveur
 * réellement joignable, pas vers localhost. Le script est rejouable — si un
 * webhook existe déjà sur cette URL, il se contente de le signaler.
 *
 * Sans PAYPAL_WEBHOOK_ID côté serveur, toutes les notifications sont
 * refusées : renouvellements et résiliations ne seraient jamais pris en
 * compte.
 */

import { paypalRequest, paypalHost } from '../src/paypal.js';
import { config } from '../src/config.js';

const EVENEMENTS = [
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.UPDATED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.EXPIRED',
  'PAYMENT.SALE.COMPLETED',
];

const url = `${config.publicUrl}/api/billing/webhook`;

if (!/^https:/.test(url)) {
  console.error(`\n  ⨯ PayPal exige une URL en HTTPS. PUBLIC_URL vaut « ${config.publicUrl} ».\n`);
  process.exit(1);
}

console.log(`\n  PayPal — environnement « ${config.paypal.environment} » (${paypalHost()})`);
console.log(`  Cible : ${url}\n`);

const existants = await paypalRequest('GET', '/v1/notifications/webhooks');
const deja = (existants.webhooks || []).find((w) => w.url === url);

if (deja) {
  console.log(`  Un webhook existe déjà sur cette URL.`);
  console.log(`\n  PAYPAL_WEBHOOK_ID=${deja.id}\n`);
  process.exit(0);
}

const cree = await paypalRequest('POST', '/v1/notifications/webhooks', {
  url,
  event_types: EVENEMENTS.map((name) => ({ name })),
});

console.log(`  Webhook créé — ${cree.event_types.length} événements écoutés.`);
console.log(`\n  PAYPAL_WEBHOOK_ID=${cree.id}\n`);
