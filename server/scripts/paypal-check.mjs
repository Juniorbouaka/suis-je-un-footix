#!/usr/bin/env node
/**
 * Vérifie à quel environnement PayPal répondent les identifiants courants.
 *
 * Un identifiant « sandbox » est refusé en live et inversement : les deux
 * mondes sont étanches. Ce test est le seul moyen fiable de savoir dans
 * lequel on se trouve — l'apparence des clés ne le dit pas.
 *
 *   cd server && railway run node scripts/paypal-check.mjs
 *
 * Passé par « railway run », le secret vient des variables du serveur et
 * n'a pas besoin d'exister en local.
 */

const id = (process.env.PAYPAL_CLIENT_ID || '').trim();
const secret = (process.env.PAYPAL_CLIENT_SECRET || '').trim();

if (!id || !secret) {
  console.error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET absents de l’environnement.');
  process.exit(1);
}

const basic = Buffer.from(`${id}:${secret}`).toString('base64');

for (const [nom, host] of [
  ['sandbox', 'https://api-m.sandbox.paypal.com'],
  ['live', 'https://api-m.paypal.com'],
]) {
  const res = await fetch(`${host}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  console.log(`  ${nom.padEnd(8)} → ${res.status} ${res.ok ? 'ACCEPTÉS' : 'refusés'}`);
}

console.log(`\n  PAYPAL_ENV vaut « ${process.env.PAYPAL_ENV || 'sandbox'} » — il doit correspondre.`);
