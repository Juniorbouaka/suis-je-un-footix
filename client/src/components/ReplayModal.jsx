import { useEffect, useState } from 'react';
import PremiumModal from './PremiumModal.jsx';

/**
 * « Ton stock est épuisé » — la fenêtre de fin de partie.
 *
 * Le moment est le sujet. Un joueur qui vient de terminer sa partie a
 * exactement une question en tête : est-ce que je peux en refaire une ? Tant
 * qu'il lui reste des parties, la réponse est oui et il n'y a rien à dire —
 * la fenêtre ne s'ouvre pas. Elle ne s'ouvre qu'au moment où la réponse
 * devient non.
 *
 * Elle ne s'adresse donc qu'aux abonnés du forfait Accès, à zéro. Un abonné
 * Illimité à zéro n'a rien à acheter : il a une date de recharge, et
 * l'écran de résultat la lui donne déjà. Lui ouvrir une fenêtre serait de la
 * publicité pour ce qu'il paie déjà.
 *
 * Trois précautions, parce qu'une fenêtre modale mal réglée devient une
 * publicité :
 *
 *   1. jamais à l'Illimité — il a déjà ce qu'on lui vendrait ;
 *   2. une fois par jour au maximum, mémorisée dans le navigateur. Perdre
 *      trois parties d'affilée ne doit pas déclencher trois fenêtres ;
 *   3. un temps de latence avant l'affichage : le résultat, le nom du
 *      joueur mystère et les confettis passent d'abord. Recouvrir la
 *      révélation par une offre commerciale, c'est gâcher les deux.
 *
 * Le texte s'adapte à l'issue. Après un échec on ne félicite pas, et on ne
 * fait pas semblant de croire que la partie était réussie.
 */

const CLE = 'footix.rejouer';
const DELAI_MS = 1100;

function aujourdHui() {
  return new Date().toISOString().slice(0, 10);
}

/** Déjà vue aujourd'hui ? Le stockage peut être fermé : on n'insiste pas. */
function dejaVue() {
  try {
    return localStorage.getItem(CLE) === aujourdHui();
  } catch {
    return false;
  }
}

function memoriser() {
  try {
    localStorage.setItem(CLE, aujourdHui());
  } catch {
    /* navigation privée, stockage plein : tant pis */
  }
}

/** Le texte, calé sur ce que le joueur vient de vivre. */
function texteFin(outcome, { mensuel, recharge }) {
  const stock = mensuel ? `Tes ${mensuel} parties du mois sont jouées` : 'Ton stock est épuisé';
  const attente = recharge ? ` Il se recharge le ${recharge}.` : '';

  if (outcome === 'found') {
    return `Bien joué — et c'était la dernière. ${stock}.${attente} La formule Illimité en donne près de quatre fois plus, à dépenser comme tu veux.`;
  }
  if (outcome === 'exhausted') {
    return `Le mystère a tenu bon, et tu n'as plus de quoi retenter. ${stock}.${attente} La formule Illimité en donne près de quatre fois plus.`;
  }
  return `Partie abandonnée, et c'était la dernière. ${stock}.${attente} La formule Illimité en donne près de quatre fois plus.`;
}

export default function ReplayModal({
  outcome = 'found',
  isPremium = false,
  credits = null,
  // Force l'affichage sans tenir compte de la fréquence ni du solde : la
  // page de test en a besoin, le jeu ne s'en sert jamais.
  force = false,
  onClose,
}) {
  const [open, setOpen] = useState(false);

  const solde = credits?.balance ?? null;
  const mensuel = credits?.monthly ?? null;
  const recharge = credits?.nextRecharge
    ? new Date(credits.nextRecharge).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
    : null;

  // Tant qu'il reste de quoi jouer, il n'y a rien à proposer. Et tant que le
  // solde est inconnu (`null`), on se tait : une fenêtre commerciale ouverte
  // sur une supposition est exactement celle qu'on ne pardonne pas.
  const aProposer = solde === 0;

  useEffect(() => {
    if (!force && (isPremium || !aProposer || dejaVue())) return undefined;

    const id = setTimeout(
      () => {
        setOpen(true);
        if (!force) memoriser();
      },
      force ? 0 : DELAI_MS
    );

    return () => clearTimeout(id);
  }, [force, isPremium, aProposer, outcome]);

  const fermer = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <PremiumModal
      open={open}
      onClose={fermer}
      kicker="Fin de partie"
      titre="Plus de parties"
      texte={texteFin(outcome, { mensuel, recharge })}
      avantages={[
        '75 parties par mois au lieu de 20',
        'Archives, duels et revanches sans compter',
        'Aucune publicité, nulle part',
        'Statistiques détaillées et thèmes de terrain',
      ]}
      cta="Passer à l’Illimité"
      dismiss="Non merci, j’attends la recharge"
      note="Une seule partie compte au classement chaque jour, quelle que soit ta formule : payer achète du temps de jeu, jamais des points."
    />
  );
}
