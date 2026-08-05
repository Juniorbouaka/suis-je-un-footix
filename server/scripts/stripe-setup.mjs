#!/usr/bin/env node
/**
 * Crée chez Stripe le produit, les deux prix d'abonnement et le webhook,
 * puis affiche les identifiants à recopier dans les variables d'environnement.
 *
 *   cd server && railway run node scripts/stripe-setup.mjs
 *
 * Passé par « railway run », la clé secrète vient des variables du serveur
 * et n'a pas besoin d'exister en local.
 *
 * À lancer DEUX FOIS dans la vie du projet : une fois avec la clé de test,
 * une fois avec la clé live. Les identifiants de prix créés avec une clé de
 * test n'existent pas en production — c'est la clé qui décide de tout.
 *
 * Le script est rejouable : la clé d'idempotence évite les doublons, et un
 * webhook déjà déclaré sur la même URL est simplement signalé.
 */

import { stripeRequest, stripeEnabled, stripeIsLive } from '../src/stripe.js';
import { config } from '../src/config.js';

if (!stripeEnabled) {
  console.error(
    `\n  ⨯ STRIPE_SECRET_KEY est absente.\n\n` +
      `    dashboard.stripe.com → Développeurs → Clés API\n` +
      `    Commence par la clé de TEST (sk_test_…).\n`
  );
  process.exit(1);
}

const mode = stripeIsLive ? 'PRODUCTION (paiements réels)' : 'test (aucun paiement réel)';
console.log(`\n  Stripe — mode ${mode}\n`);

const EVENEMENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
];

const suffixe = stripeIsLive ? 'live' : 'test';

/* ---------------------------------------------------------------- *
 *  1. Le produit
 * ---------------------------------------------------------------- */

const produit = await stripeRequest(
  'POST',
  '/products',
  {
    name: 'Suis-je un footix ? — Premium',
    description: 'Sans publicité, archives complètes, statistiques détaillées et thèmes.',
  },
  { 'Idempotency-Key': `footix-produit-${suffixe}` }
);

console.log(`  produit créé : ${produit.id}`);

/* ---------------------------------------------------------------- *
 *  2. Les deux prix
 * ---------------------------------------------------------------- */

const PRIX = [
  { cle: 'monthly', env: 'STRIPE_PRICE_MONTHLY', centimes: 299, interval: 'month' },
  { cle: 'yearly', env: 'STRIPE_PRICE_YEARLY', centimes: 1999, interval: 'year' },
];

const resultats = [];

for (const p of PRIX) {
  try {
    const prix = await stripeRequest(
      'POST',
      '/prices',
      {
        product: produit.id,
        currency: 'eur',
        unit_amount: p.centimes,
        recurring: { interval: p.interval },
        nickname: `Premium ${p.cle === 'monthly' ? 'mensuel' : 'annuel'}`,
      },
      { 'Idempotency-Key': `footix-prix-${p.cle}-${suffixe}` }
    );
    console.log(`  prix ${p.cle} créé : ${prix.id}`);
    resultats.push({ ...p, id: prix.id });
  } catch (err) {
    console.error(`  ⨯ prix ${p.cle} : ${err.message}`);
  }
}

/* ---------------------------------------------------------------- *
 *  3. Le webhook
 * ---------------------------------------------------------------- */

const url = `${config.publicUrl}/api/stripe/webhook`;
let secretWebhook = null;

if (!/^https:/.test(url)) {
  console.error(`\n  ⨯ Stripe exige une URL en HTTPS. PUBLIC_URL vaut « ${config.publicUrl} ».`);
} else {
  const existants = await stripeRequest('GET', '/webhook_endpoints?limit=100');
  const deja = (existants.data || []).find((w) => w.url === url);

  if (deja) {
    console.log(`\n  Un webhook existe déjà sur cette URL : ${deja.id}`);
    console.log(`  Son secret n'est visible qu'à la création — supprime-le dans le`);
    console.log(`  tableau de bord et relance ce script si tu l'as perdu.`);
  } else {
    const wh = await stripeRequest('POST', '/webhook_endpoints', {
      url,
      enabled_events: EVENEMENTS,
      description: 'Suis-je un footix ? — abonnements et dons',
    });
    secretWebhook = wh.secret;
    console.log(`\n  webhook créé : ${wh.id} (${EVENEMENTS.length} événements)`);
  }
}

/* ---------------------------------------------------------------- *
 *  4. Ce qu'il reste à poser
 * ---------------------------------------------------------------- */

console.log(`\n  ── À recopier dans les variables d'environnement ──\n`);
for (const r of resultats) console.log(`  ${r.env}=${r.id}`);
if (secretWebhook) console.log(`  STRIPE_WEBHOOK_SECRET=${secretWebhook}`);

console.log(
  `\n  Sans STRIPE_WEBHOOK_SECRET, tous les webhooks sont refusés : les\n` +
    `  renouvellements et les résiliations ne seraient jamais pris en compte.\n`
);

if (!stripeIsLive) {
  console.log(
    `  Mode test : paie avec la carte 4242 4242 4242 4242, n'importe quelle\n` +
      `  date future et n'importe quel CVC.\n`
  );
}
