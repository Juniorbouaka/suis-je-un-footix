#!/usr/bin/env node
/**
 * Crée chez PayPal le produit et les deux plans d'abonnement, puis affiche
 * les identifiants à recopier dans les variables d'environnement.
 *
 *   cd server && npm run paypal:setup
 *
 * À lancer DEUX FOIS dans la vie du projet : une fois avec les identifiants
 * sandbox (PAYPAL_ENV=sandbox) pour les essais, une fois avec les identifiants
 * live (PAYPAL_ENV=live) le jour de la mise en production. Les deux mondes
 * sont étanches : un plan sandbox n'existe pas en live.
 *
 * Le script est rejouable : PayPal refuse un plan déjà créé avec la même
 * clé d'idempotence et le script se contente alors de le signaler.
 */

import { config } from '../src/config.js';
import { paypalRequest, paypalHost } from '../src/paypal.js';

const { clientId, clientSecret, environment } = config.paypal;

if (!clientId || !clientSecret) {
  console.error(
    `\n  ⨯ PAYPAL_CLIENT_ID et PAYPAL_CLIENT_SECRET sont requis.\n\n` +
      `    Récupère-les sur https://developer.paypal.com/dashboard/applications\n` +
      `    (onglet Sandbox pour les essais, Live pour la production), puis\n` +
      `    renseigne-les dans server/.env avant de relancer.\n`
  );
  process.exit(1);
}

const MOIS = { interval_unit: 'MONTH', interval_count: 1 };

const PLANS = [
  {
    key: 'access',
    env: 'PAYPAL_PLAN_ACCESS',
    name: 'Footix — Accès',
    label: '20 parties par mois',
    price: '2.99',
    interval: MOIS,
  },
  {
    key: 'unlimited',
    env: 'PAYPAL_PLAN_UNLIMITED',
    name: 'Footix — Illimité',
    label: '75 parties par mois',
    price: '9.99',
    interval: MOIS,
  },
];

console.log(`\n  PayPal — environnement « ${environment} » (${paypalHost()})\n`);

/* ---------------------------------------------------------------- *
 *  1. Le produit — un seul, commun aux deux formules
 * ---------------------------------------------------------------- */

const product = await paypalRequest(
  'POST',
  '/v1/catalogs/products',
  {
    name: 'Suis-je un footix ?',
    description: 'Abonnement au jeu : un stock de parties rechargé chaque mois.',
    type: 'SERVICE',
    category: 'ONLINE_GAMING',
  },
  // Clé de requête nouvelle : l'ancienne renverrait le produit « Premium »
  // d'avant les crédits au lieu d'en créer un.
  { 'PayPal-Request-Id': `footix-product-credits-${environment}` }
);

console.log(`  produit créé : ${product.id}`);

/* ---------------------------------------------------------------- *
 *  2. Les deux plans
 * ---------------------------------------------------------------- */

const results = [];

for (const plan of PLANS) {
  try {
    const created = await paypalRequest(
      'POST',
      '/v1/billing/plans',
      {
        product_id: product.id,
        name: plan.name,
        description: `Abonnement mensuel — ${plan.label}.`,
        status: 'ACTIVE',
        billing_cycles: [
          {
            frequency: plan.interval,
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0, // reconduction sans fin
            pricing_scheme: {
              fixed_price: { value: plan.price, currency_code: 'EUR' },
            },
          },
        ],
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee_failure_action: 'CONTINUE',
          // Trois échecs de prélèvement et l'abonnement est suspendu.
          payment_failure_threshold: 3,
        },
      },
      { 'PayPal-Request-Id': `footix-plan-${plan.key}-${environment}` }
    );

    console.log(`  plan ${plan.key} créé : ${created.id}`);
    results.push({ ...plan, id: created.id });
  } catch (err) {
    console.error(`  ⨯ plan ${plan.key} : ${err.message}`);
  }
}

/* ---------------------------------------------------------------- *
 *  3. Ce qu'il reste à faire à la main
 * ---------------------------------------------------------------- */

console.log(`\n  ── À recopier dans les variables d'environnement ──\n`);
console.log(`  PAYPAL_ENV=${environment}`);
for (const r of results) console.log(`  ${r.env}=${r.id}`);

console.log(
  `\n  ── Dernière étape : le webhook ──\n\n` +
    `  1. https://developer.paypal.com/dashboard/applications → ton application\n` +
    `  2. « Add Webhook », URL : ${config.publicUrl}/api/billing/webhook\n` +
    `  3. Coche ces événements :\n` +
    `       BILLING.SUBSCRIPTION.ACTIVATED\n` +
    `       BILLING.SUBSCRIPTION.UPDATED\n` +
    `       BILLING.SUBSCRIPTION.CANCELLED\n` +
    `       BILLING.SUBSCRIPTION.SUSPENDED\n` +
    `       BILLING.SUBSCRIPTION.EXPIRED\n` +
    `       PAYMENT.SALE.COMPLETED\n` +
    `  4. Recopie l'identifiant du webhook dans PAYPAL_WEBHOOK_ID\n\n` +
    `  Sans PAYPAL_WEBHOOK_ID, tous les webhooks sont refusés : les\n` +
    `  renouvellements et les résiliations ne seraient jamais pris en compte.\n`
);
