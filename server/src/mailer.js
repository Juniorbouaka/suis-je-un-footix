import { config } from './config.js';

/**
 * Envoi d'e-mails.
 *
 * Aucune dépendance : on parle directement à l'API HTTP du fournisseur.
 * Deux modes :
 *   - RESEND_API_KEY renseignée  → envoi réel via Resend (resend.com)
 *   - sinon                      → le message est écrit dans les logs du serveur
 *
 * Le mode « logs » permet de développer et de tester tout le parcours sans
 * fournisseur. En production, l'absence de clé est signalée à chaque envoi :
 * le lien existe bien, mais personne ne le reçoit.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export const mailerEnabled = Boolean(config.mail.apiKey);

export async function sendMail({ to, subject, text }) {
  if (!mailerEnabled) {
    console.warn(
      `\n  ✉ E-MAIL NON ENVOYÉ (aucun fournisseur configuré)\n` +
        `    À      : ${to}\n` +
        `    Objet  : ${subject}\n` +
        `    ${text.split('\n').join('\n    ')}\n` +
        `    → renseigne RESEND_API_KEY pour un envoi réel.\n`
    );
    return { delivered: false, reason: 'no_provider' };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.mail.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: config.mail.from, to: [to], subject, text }),
    });

    if (!res.ok) {
      console.error('[mail] échec :', res.status, await res.text());
      return { delivered: false, reason: 'provider_error' };
    }
    return { delivered: true };
  } catch (err) {
    console.error('[mail] échec réseau :', err.message);
    return { delivered: false, reason: 'network' };
  }
}

export function resetEmail({ username, link }) {
  return {
    subject: 'Réinitialise ton mot de passe — Suis-je un footix ?',
    text: `Salut ${username},

Tu as demandé à réinitialiser ton mot de passe. Ouvre ce lien, il est valable une heure :

${link}

Si ce n'est pas toi, ignore ce message : ton mot de passe reste inchangé.

— Suis-je un footix ?`,
  };
}
