#!/usr/bin/env node
/**
 * Vérifie qu'un abonnement peut réellement s'ouvrir avec la configuration
 * courante, sans créer de compte sur le site.
 *
 *   cd server && railway run node scripts/paypal-smoke.mjs
 *
 * L'abonnement créé reste en attente d'approbation et expire de lui-même :
 * personne n'est débité. Le test confirme surtout que le lien de paiement
 * pointe vers le vrai PayPal et non vers le bac à sable.
 */

import { createSubscription } from '../src/paypal.js';
import { config } from '../src/config.js';

const planId = config.paypal.plans.access;
if (!planId) {
  console.error('\n  ⨯ PAYPAL_PLAN_ACCESS est vide : rien à tester.\n');
  process.exit(1);
}

const s = await createSubscription({
  planId,
  userId: 'verification-technique',
  returnUrl: `${config.publicUrl}/premium/merci`,
  cancelUrl: `${config.publicUrl}/premium?annule=1`,
});

const reel = /^https:\/\/www\.paypal\.com/.test(s.approveUrl);

console.log(`\n  Abonnement de test : ${s.id} (statut ${s.status})`);
console.log(`  Lien de paiement   : ${s.approveUrl.split('?')[0]}`);
console.log(`\n  ${reel ? '✓ PayPal réel — les paiements seront encaissés.' : '⚠ Bac à sable — aucun paiement réel possible.'}\n`);
