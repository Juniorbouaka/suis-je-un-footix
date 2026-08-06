/**
 * Accorde (ou retire) le premium à un compte, à la main.
 *
 * Usage :
 *   npm run premium -- juniorbouaka9@gmail.com
 *   npm run premium -- juniorbouaka9@gmail.com --retirer
 *
 * En production, la base vit dans le volume de l'hébergeur : la commande doit
 * donc y être lancée (`railway run npm run premium -- <email>`), sinon elle ne
 * touche que la copie locale.
 *
 * `premium_until` reste NUL : c'est la marque d'un premium accordé à la main,
 * que `expireIfNeeded` laisse tranquille — il ne s'éteindra jamais tout seul.
 */
import { db } from '../src/db.js';

const args = process.argv.slice(2);
const retirer = args.includes('--retirer');
const email = args.find((a) => !a.startsWith('--'));

if (!email) {
  console.error('Usage : npm run premium -- <email> [--retirer]');
  process.exit(1);
}

const user = db
  .prepare('SELECT id, username, email, is_premium FROM users WHERE lower(email) = lower(?)')
  .get(email.trim());

if (!user) {
  console.error(`Aucun compte avec l'adresse ${email}.`);
  process.exit(1);
}

if (retirer) {
  db.prepare(
    `UPDATE users
        SET is_premium = 0, subscription_provider = NULL, subscription_status = NULL,
            premium_until = NULL
      WHERE id = ?`
  ).run(user.id);
  console.log(`Premium retiré à ${user.username} <${user.email}>.`);
} else {
  db.prepare(
    `UPDATE users
        SET is_premium = 1,
            subscription_provider = 'manuel',
            subscription_status = 'MANUAL',
            subscription_plan = COALESCE(subscription_plan, 'yearly'),
            premium_until = NULL
      WHERE id = ?`
  ).run(user.id);
  console.log(`Premium accordé à ${user.username} <${user.email}> — sans échéance.`);
}
