#!/usr/bin/env node
/**
 * Vérifie que la clé Stripe courante fonctionne, et dans quel mode.
 *
 *   cd server && railway run node scripts/stripe-check.mjs
 *
 * Passé par « railway run », la clé vient des variables du serveur et n'a
 * pas besoin d'exister en local. Elle n'est jamais affichée en entier.
 */

import { stripeRequest, stripeEnabled, stripeIsLive } from '../src/stripe.js';

const cle = process.env.STRIPE_SECRET_KEY || '';

if (!stripeEnabled) {
  console.error('\n  ⨯ STRIPE_SECRET_KEY absente de l’environnement.\n');
  process.exit(1);
}

console.log(`\n  Clé   : ${cle.slice(0, 8)}…${cle.slice(-4)} (${cle.length} caractères)`);
console.log(`  Mode  : ${stripeIsLive ? 'PRODUCTION — paiements réels' : 'test — aucun paiement réel'}`);

try {
  const compte = await stripeRequest('GET', '/account');
  console.log(`  Compte: ${compte.id} · ${compte.country || '?'} · ${(compte.default_currency || '?').toUpperCase()}`);
  console.log(`  Paiements activés : ${compte.charges_enabled ? 'oui' : 'NON'}`);
  console.log(`  Virements activés : ${compte.payouts_enabled ? 'oui' : 'NON'}\n`);
} catch (err) {
  console.error(`\n  ⨯ ${err.message}\n`);
  process.exit(1);
}
