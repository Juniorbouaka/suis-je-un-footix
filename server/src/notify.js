import { db } from './db.js';
import { config } from './config.js';
import { sendMail } from './mailer.js';

/**
 * L'alerte de vente.
 *
 * Le problème qu'elle résout n'est pas technique : l'argent tombe chez
 * Stripe et PayPal, le jeu tourne ici, et rien ne reliait les deux. Une
 * vente se découvrait en allant la chercher dans un tableau de bord tiers —
 * autant dire jamais. On peut vendre pendant trois semaines sans le savoir,
 * et c'est la façon la plus sûre de laisser mourir une chose qui marche.
 *
 * Trois règles tiennent ce module :
 *
 *   1. Une vente, un e-mail. Chaque encaissement arrive par DEUX chemins —
 *      le retour du navigateur, puis le webhook qui fait foi — et cette
 *      redondance est voulue côté droits. Côté boîte mail, elle ne l'est
 *      pas : `sale_alerts` porte la référence de la VENTE et non celle de
 *      l'événement, ce qui fait tomber les deux chemins sur la même clé.
 *
 *   2. Prévenir ne doit JAMAIS faire échouer l'encaissement. Tout est
 *      avalé ici : fournisseur d'e-mail absent, réseau coupé, adresse
 *      invalide. Un webhook qui répondrait 500 parce qu'un e-mail n'est
 *      pas parti serait rejoué par Stripe pendant trois jours — pour rien,
 *      puisque l'argent, lui, est déjà arrivé.
 *
 *   3. L'e-mail se lit sur un téléphone, debout, en trois secondes. Le
 *      montant et le forfait sont dans l'OBJET : c'est souvent tout ce
 *      qu'on lira. Le corps ajoute qui, par quel encaisseur, et où en est
 *      le jeu — combien d'abonnés actifs, combien de ventes aujourd'hui.
 *      Une vente seule est une anecdote ; une vente avec son total est une
 *      information.
 */

/** À qui écrire. ADMIN_EMAILS par défaut : c'est déjà la bonne personne. */
function destinataires() {
  return config.notify.salesTo.length ? config.notify.salesTo : config.adminEmails;
}

/**
 * Cette vente a-t-elle déjà été annoncée ?
 *
 * L'insertion FAIT la réservation : c'est SQLite qui arbitre, pas une
 * lecture suivie d'une écriture. Le retour du navigateur et le webhook
 * peuvent arriver à la même seconde — c'est même le cas normal — et un
 * `SELECT` puis `INSERT` aurait laissé passer les deux.
 */
function premiereFois(ref, kind) {
  try {
    const res = db
      .prepare('INSERT OR IGNORE INTO sale_alerts (ref, kind) VALUES (?, ?)')
      .run(ref, kind);
    return res.changes === 1;
  } catch (err) {
    // Une table absente ne doit pas empêcher de prévenir : mieux vaut deux
    // e-mails qu'aucun.
    console.error('[vente] mémoire des alertes :', err.message);
    return true;
  }
}

/** Qui a payé. Le pseudo pour lire vite, l'e-mail pour retrouver le compte. */
function qui(userId) {
  if (!userId) return 'Visiteur non connecté';
  const u = db.prepare('SELECT username, email FROM users WHERE id = ?').get(userId);
  if (!u) return userId;
  return `${u.username} <${u.email}>`;
}

/**
 * Où en est le jeu, en deux chiffres.
 *
 * C'est ce qui transforme la notification en information : « +2,99 € » ne
 * dit rien, « +2,99 €, 14e abonné, 3e vente aujourd'hui » dit tout. Deux
 * requêtes comptées sur des tables minuscules, sur un chemin qui n'est
 * emprunté que lorsque quelqu'un paie.
 */
function etatDuJeu() {
  try {
    const abonnes = db
      .prepare('SELECT COUNT(*) AS n FROM users WHERE is_subscriber = 1 OR is_premium = 1')
      .get().n;
    const ventesDuJour = db
      .prepare("SELECT COUNT(*) AS n FROM sale_alerts WHERE date(created_at) = date('now')")
      .get().n;
    return `${abonnes} abonné(s) actif(s) · ${ventesDuJour} vente(s) aujourd'hui`;
  } catch {
    return null;
  }
}

/**
 * Annonce une vente.
 *
 * Ne rend jamais la main sur une erreur et ne se fait jamais attendre : les
 * appelants sont des webhooks et des routes de paiement, ils ont mieux à
 * faire que d'attendre un fournisseur d'e-mail. L'envoi part sans `await`,
 * la réservation de la référence, elle, est synchrone — c'est elle qui
 * garantit l'unicité, et elle doit être faite avant que le second chemin
 * n'arrive.
 *
 * @param {object}  vente
 * @param {string}  vente.kind      'abonnement' | 'renouvellement' | 'formule' | 'recharge' | 'don'
 * @param {string}  vente.ref       référence de la VENTE (pas de l'événement)
 * @param {string}  vente.resume    la ligne qui part dans l'objet du message
 * @param {string} [vente.userId]   le compte concerné, s'il y en a un
 * @param {string[]} [vente.details] lignes supplémentaires du corps
 */
export function notifySale({ kind, ref, resume, userId = null, details = [] }) {
  try {
    if (!ref) return;
    if (!premiereFois(ref, kind)) return;

    // La console reçoit la vente même sans destinataire : les logs de
    // l'hébergeur sont le dernier endroit où elle reste visible.
    console.log(`[vente] ${kind} — ${resume} — ${qui(userId)}`);

    const to = destinataires();
    if (!to.length) return;

    const corps = [
      resume,
      '',
      `Compte     : ${qui(userId)}`,
      ...details.map((d) => `${d}`),
      `Référence  : ${ref}`,
      '',
      etatDuJeu(),
      '',
      '— Suis-je un footix ?',
    ]
      .filter((l) => l !== null && l !== undefined)
      .join('\n');

    for (const adresse of to) {
      // Volontairement sans `await` : prévenir est secondaire, encaisser ne
      // l'est pas. Une promesse rejetée sans `catch` couperait le processus
      // Node, d'où l'attrapeur — c'est le seul rôle de cette ligne.
      sendMail({ to: adresse, subject: `💶 ${resume}`, text: corps }).catch((err) =>
        console.error('[vente] alerte non envoyée :', err.message)
      );
    }
  } catch (err) {
    /*
     * Le filet, et il n'est pas décoratif : cette fonction est appelée
     * depuis l'intérieur des webhooks de paiement. Une exception ici ferait
     * répondre 500 à Stripe, qui rejouerait l'événement pendant trois jours
     * — alors que l'argent est arrivé et les droits déjà ouverts.
     */
    console.error('[vente] alerte impossible :', err.message);
  }
}
