#!/usr/bin/env node
/**
 * Vérifie sur quel compte PayPal atterrissent les paiements.
 *
 *   cd server && railway run node scripts/paypal-payee.mjs
 *
 * L'argent va toujours au compte propriétaire des identifiants d'API. Ce
 * script le rend explicite : une commande de test est créée (jamais payée,
 * elle expire seule) et PayPal renvoie le bénéficiaire.
 */

import { paypalRequest } from '../src/paypal.js';
import { config } from '../src/config.js';

const o = await paypalRequest('POST', '/v2/checkout/orders', {
  intent: 'CAPTURE',
  purchase_units: [
    { amount: { currency_code: 'EUR', value: '2.00' }, description: 'Vérification technique' },
  ],
});

// La création renvoie une réponse minimale : il faut relire la commande
// pour obtenir le bénéficiaire.
const detail = await paypalRequest('GET', `/v2/checkout/orders/${o.id}`);
const payee = detail.purchase_units?.[0]?.payee;

console.log(`\n  Environnement : ${config.paypal.environment}`);
console.log(`  Commande      : ${o.id} (${o.status}) — non payée, elle expirera seule`);
console.log(`  Bénéficiaire  : ${payee ? JSON.stringify(payee) : '(non communiqué)'}\n`);
