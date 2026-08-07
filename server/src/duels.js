import { config } from './config.js';
import { creditSummary } from './credits.js';

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
    // Ce que l'écran a besoin de savoir avant d'allumer ou d'éteindre un
    // bouton. Répondre ici évite que chaque écran refasse la soustraction —
    // et se trompe de tarif entre la file et l'invitation.
    canQueue: solde >= config.credits.costDuel,
    canInvite: solde >= config.credits.costDuelInvite,
    // Nombre de duels encore payables par la file aléatoire.
    remaining: Math.floor(solde / Math.max(1, config.credits.costDuel)),
  };
}
