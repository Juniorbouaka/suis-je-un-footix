import { useEffect, useState } from 'react';
import PremiumModal from './PremiumModal.jsx';

/**
 * « Envie de rejouer ? » — la fenêtre de fin de partie.
 *
 * Le moment est le sujet. Un joueur qui vient de terminer sa partie du jour
 * a exactement une question en tête : est-ce que je peux en refaire une ?
 * En gratuit la réponse est non, et il faut la dire sans détour — puis
 * montrer ce que l'abonnement change : cinq parties par jour au lieu d'une,
 * dont quatre d'entraînement qui ne comptent pas au classement.
 *
 * Trois précautions, parce qu'une fenêtre modale mal réglée devient une
 * publicité :
 *
 *   1. jamais aux abonnés — ils ont déjà ce qu'on leur vendrait ;
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

/**
 * Le texte, calé sur ce que le joueur vient de vivre.
 * `entrainement` est le nombre de parties d'entraînement de l'abonnement.
 */
function texteFin(outcome, { maxAttempts, premiumAttempts, entrainement }) {
  if (outcome === 'found') {
    return `Bien joué. Mais le prochain joueur mystère n'arrive qu'à minuit — sauf pour les abonnés, qui enchaînent ${entrainement} parties d'entraînement dans la foulée, sans attendre.`;
  }
  if (outcome === 'exhausted') {
    return `Tes ${maxAttempts} chances sont passées et le mystère a tenu bon. L'abonnement en donne ${premiumAttempts}, et ${entrainement} parties d'entraînement par jour pour se refaire tout de suite.`;
  }
  return `Partie abandonnée — et la prochaine n'arrive qu'à minuit. L'abonnement ouvre ${entrainement} parties d'entraînement par jour, à jouer maintenant.`;
}

export default function ReplayModal({
  outcome = 'found',
  isPremium = false,
  maxAttempts = 15,
  premiumAttempts = 50,
  gamesPerDay = 5,
  // Force l'affichage sans tenir compte de la fréquence : la page de test
  // en a besoin, le jeu ne s'en sert jamais.
  force = false,
  onClose,
}) {
  const entrainement = Math.max(1, gamesPerDay - 1);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!force && (isPremium || dejaVue())) return undefined;

    const id = setTimeout(() => {
      setOpen(true);
      if (!force) memoriser();
    }, force ? 0 : DELAI_MS);

    return () => clearTimeout(id);
  }, [force, isPremium, outcome]);

  const fermer = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <PremiumModal
      open={open}
      onClose={fermer}
      kicker="Fin de partie"
      titre="Envie de rejouer ?"
      texte={texteFin(outcome, { maxAttempts, premiumAttempts, entrainement })}
      avantages={[
        `${gamesPerDay} parties par jour au lieu d’une`,
        `${entrainement} d’entraînement, hors classement`,
        `${premiumAttempts} chances par partie au lieu de ${maxAttempts}`,
        '5 duels par jour au lieu d’un seul',
        'Aucune publicité, toutes les archives',
      ]}
      cta="Voir l’abonnement"
      dismiss="Non merci, je reviens demain"
      note="Les parties d’entraînement ne rapportent aucun point : le classement reste le même pour tout le monde."
    />
  );
}
