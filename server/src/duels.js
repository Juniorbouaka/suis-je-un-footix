import { config, isAdminEmail } from './config.js';
import { creditSummary } from './credits.js';
import { db } from './db.js';
import { duelTrialState } from './trial.js';

/**
 * L'état d'essai d'un compte, relu en base.
 *
 * Le raccourci de l'administrateur est refait ici, exactement comme dans
 * `credits.js` : la base le voit toujours comme non-abonné, et sans cette
 * correction l'écran de duel lui annoncerait « 1 duel offert » sur son
 * propre jeu, avant de le décompter. Celui qui paie l'API n'essaie pas.
 *
 * Relu en base plutôt que reçu de l'appelant : les deux points d'entrée du
 * module reçoivent un identifiant, pas un utilisateur, et une règle d'accès
 * qui dépend de qui appelle est une règle qu'on oublie d'appliquer quelque
 * part.
 */
function essaiDuel(userId) {
  const u = db
    .prepare('SELECT email, is_subscriber, is_premium, trial_duels_used FROM users WHERE id = ?')
    .get(userId);

  if (!u) return duelTrialState(null);
  return duelTrialState(isAdminEmail(u.email) ? { ...u, is_subscriber: 1, is_premium: 1 } : u);
}

/**
 * Ce qu'un duel coûte, et ce qu'on peut encore s'offrir.
 *
 * Il n'y a plus de quota de duels quotidien : le portefeuille a remplacé le
 * compteur. Un duel se paie en crédits comme une partie solo, et le joueur
 * arbitre lui-même entre les deux — c'est son stock, c'est son choix.
 *
 * Deux tarifs, parce qu'il y a deux façons d'entrer dans un duel :
 *
 *   — la file aléatoire : chacun paie son propre crédit. Deux joueurs, deux
 *     crédits, un de chaque côté. C'est l'équité la plus simple.
 *
 *   — l'invitation : l'HÔTE paie pour deux, l'invité ne paie rien. Celui qui
 *     invite offre la partie, littéralement. C'était la demande, et elle a
 *     un vrai mérite : on peut faire jouer un ami qui n'a plus un crédit, ou
 *     qui vient d'arriver, sans qu'il ait à sortir sa carte pour répondre à
 *     une invitation. C'est le seul chemin par lequel un joueur peut jouer
 *     sans dépenser, et il est payé par quelqu'un.
 *
 * Le solde est relu en base à chaque appel plutôt que pris sur la socket :
 * un joueur qui recharge ou s'abonne pendant sa session en profite tout de
 * suite, sans se reconnecter.
 */
export function duelQuota(userId) {
  const credits = creditSummary(userId);
  const solde = credits?.balance ?? 0;
  const essai = essaiDuel(userId);

  return {
    /*
     * Le résumé complet du portefeuille est repris tel quel, et pas seulement
     * le solde : le client range toutes ces réponses dans un même dépôt, et
     * un résumé amputé de sa date de recharge effacerait celle qu'il avait
     * déjà. Les champs propres au duel s'ajoutent par-dessus.
     */
    ...credits,
    balance: solde,
    monthly: credits?.monthly ?? 0,
    nextRecharge: credits?.nextRecharge ?? null,
    // Ce que coûte chaque façon d'entrer en duel.
    cost: config.credits.costDuel,
    inviteCost: config.credits.costDuelInvite,
    /*
     * Le duel offert, tel quel : l'écran doit pouvoir annoncer « ton premier
     * duel est offert » AVANT le clic, et « c'était le dernier gratuit »
     * après. Un essai qu'on ne découvre qu'au moment où il s'arrête ne vend
     * rien — il déçoit.
     */
    free: essai,
    /*
     * Ce que l'écran a besoin de savoir avant d'allumer ou d'éteindre un
     * bouton. Répondre ici évite que chaque écran refasse la soustraction —
     * et se trompe de tarif entre la file et l'invitation.
     *
     * L'essai compte pour la FILE et pour elle seule : il paie le siège de
     * son joueur, pas celui d'un invité. Inviter reste à deux crédits, donc
     * réservé à qui en a — sans quoi l'essai offrirait une partie à un
     * tiers, ce qui n'est plus un essai mais un distributeur.
     *
     * `active` et non `remaining` : un abonné garde un compteur d'essai
     * intact — il n'y a jamais touché — mais ce sont ses crédits qui paient
     * ses duels, parce que `payerDuel` n'ouvre l'essai qu'aux comptes qui
     * n'ont rien payé. Lire `remaining` ici allumerait le bouton d'un
     * abonné à sec, refusé ensuite à la facture : une porte qui dit oui et
     * une caisse qui dit non, c'est un salon formé pour rien.
     */
    canQueue: solde >= config.credits.costDuel || essai.active,
    canInvite: solde >= config.credits.costDuelInvite,
    // Nombre de duels encore jouables par la file aléatoire, essai compris :
    // c'est un nombre de parties, peu importe qui les paie.
    remaining:
      Math.floor(solde / Math.max(1, config.credits.costDuel)) +
      (essai.active ? essai.remaining : 0),
  };
}

/* ------------------------------------------------------------------ *
 *  Les duels en cours, vus de l'extérieur
 * ------------------------------------------------------------------ */

/**
 * Le registre des salons vit dans `realtime.js`, en mémoire, et personne
 * d'autre n'a à le connaître. Une seule question doit en sortir : « ce
 * compte est-il en train de jouer ? »
 *
 * Elle sert au mur de paiement de la socket. Un joueur qui a dépensé son
 * duel offert n'a plus le droit d'en ouvrir un — mais il a le droit de
 * FINIR celui qu'il a commencé, et rafraîchir la page ne doit pas le faire
 * déclarer forfait dans sa seule partie gratuite. Sans cette exception, le
 * premier rechargement le mettrait dehors et donnerait la victoire à son
 * adversaire : la pire démonstration possible.
 *
 * Le passage se fait par une fonction déposée ici plutôt que par un import
 * direct, parce que `realtime.js` importe déjà `auth.js` : demander à
 * `auth.js` de lire `realtime.js` refermerait le cercle. Ce module-ci ne
 * dépend de personne, il est le point de rendez-vous naturel.
 *
 * Tant que rien n'est déposé, la réponse est « non » — c'est le cas des
 * tests qui montent l'API sans serveur temps réel, et c'est la bonne
 * réponse pour eux : sans socket, aucun duel n'est en cours.
 */
let salonEnCours = () => false;

export function suivreDuelsEnCours(predicat) {
  salonEnCours = typeof predicat === 'function' ? predicat : () => false;
}

export function aUnDuelEnCours(userId) {
  try {
    return Boolean(userId && salonEnCours(userId));
  } catch {
    return false;
  }
}
