import { useSyncExternalStore } from 'react';

/**
 * Le portefeuille, côté écran.
 *
 * Un seul chiffre, affiché à plusieurs endroits en même temps : l'en-tête,
 * la page de jeu, l'écran de duel. Il change au milieu d'une partie, et il
 * doit changer PARTOUT au même moment — un solde à 3 dans l'en-tête pendant
 * que la page annonce 2, c'est la première chose qu'un joueur remarque et la
 * dernière qu'il pardonne quand il s'agit de son argent.
 *
 * D'où ce petit dépôt commun plutôt qu'un état par page. Chaque réponse du
 * serveur qui porte un `credits` le publie ici ; tout ce qui l'affiche s'y
 * abonne. Le serveur reste la seule source de vérité : on ne décrémente
 * jamais le solde nous-mêmes, on recopie ce qu'il vient de dire.
 *
 * Ce n'est pas un cache — rien n'est relu d'ici. C'est le dernier état connu,
 * et il ne survit pas au rechargement de la page : au démarrage, c'est le
 * profil qui le remplit.
 */

let etat = null;
const abonnes = new Set();

/**
 * Publie le portefeuille renvoyé par le serveur.
 *
 * Tolérant à `null` et aux réponses qui n'en portent pas : la plupart des
 * appels de jeu n'en renvoient qu'aux moments utiles (première proposition,
 * fin de partie), et les autres ne doivent surtout pas effacer le solde
 * connu en passant.
 */
export function publierCredits(resume) {
  if (!resume || typeof resume.balance !== 'number') return;
  etat = resume;
  for (const notifier of abonnes) notifier();
}

function abonner(notifier) {
  abonnes.add(notifier);
  return () => abonnes.delete(notifier);
}

function lire() {
  return etat;
}

/**
 * Le portefeuille le plus frais qu'on connaisse.
 *
 * `secours` sert de valeur de départ — en pratique celui du profil, chargé
 * une fois au démarrage. Dès qu'une partie publie un solde, c'est lui qui
 * gagne : il est forcément plus récent.
 */
export function useCredits(secours = null) {
  const publie = useSyncExternalStore(abonner, lire, lire);
  return publie || secours;
}

/** Remet le portefeuille à zéro. Appelé à la déconnexion. */
export function oublierCredits() {
  etat = null;
  for (const notifier of abonnes) notifier();
}

/**
 * « 3 parties » plutôt que « 3 crédits ».
 *
 * Le mot « crédit » ne dit rien à personne — c'est du vocabulaire de
 * facturation. Ce que le joueur veut savoir, c'est combien de parties il
 * peut encore lancer, et une partie coûte un crédit. On compte donc en
 * parties partout où l'on parle au joueur.
 */
export function enParties(solde) {
  const n = Math.max(0, Number(solde) || 0);
  return `${n} partie${n > 1 ? 's' : ''}`;
}
