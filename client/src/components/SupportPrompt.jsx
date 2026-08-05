import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import Icon from './Icon.jsx';

/**
 * Invitation à soutenir le jeu, affichée après une réussite.
 *
 * Tout l'enjeu est de ne pas devenir une bannière publicitaire. Quatre
 * règles s'en chargent, et elles comptent plus que le graphisme :
 *
 *   1. jamais aux abonnés premium — ils paient déjà, le leur redemander
 *      est maladroit ;
 *   2. jamais à qui a déjà donné ;
 *   3. pas avant la 3e partie terminée — laisser aimer le jeu d'abord ;
 *   4. une fois par semaine au maximum, et après trois refus on espace
 *      à trente jours. Qui ne veut pas donner ne veut pas donner.
 *
 * On ne l'affiche jamais après un échec ou une défaite : demander de
 * l'argent à quelqu'un qui vient de perdre est le meilleur moyen de le
 * braquer. C'est à l'appelant de ne monter ce composant qu'après une
 * issue heureuse.
 */

const CLE = 'footix.support';
const SEMAINE = 7 * 24 * 3600 * 1000;
const MOIS = 30 * 24 * 3600 * 1000;
const PARTIES_MINIMUM = 3;

function lire() {
  try {
    return JSON.parse(localStorage.getItem(CLE) || '{}');
  } catch {
    return {};
  }
}

function ecrire(etat) {
  try {
    localStorage.setItem(CLE, JSON.stringify(etat));
  } catch {
    /* navigation privée, stockage plein : tant pis, on n'insiste pas */
  }
}

/** À appeler depuis la page de remerciement : coupe définitivement l'invitation. */
export function marquerDonateur() {
  ecrire({ ...lire(), donateur: true });
}

/** L'invitation a-t-elle le droit de s'afficher ? */
function autorise({ isPremium, partiesJouees }) {
  if (isPremium) return false;
  if (partiesJouees < PARTIES_MINIMUM) return false;

  const etat = lire();
  if (etat.donateur) return false;

  const delai = (etat.refus || 0) >= 3 ? MOIS : SEMAINE;
  if (etat.vuLe && Date.now() - etat.vuLe < delai) return false;

  return true;
}

/** Le message se cale sur ce que le joueur vient de vivre. */
function messagePour(contexte, serie) {
  if (serie >= 30) {
    return `${serie} jours d'affilée. À ce stade tu fais partie des habitués — et les habitués font vivre le jeu.`;
  }
  if (serie >= 7) {
    return `${serie} jours d'affilée, bravo. Chaque proposition évaluée coûte quelques centimes d'IA : un coup de pouce aide à tenir.`;
  }
  if (contexte === 'duel') {
    return 'Bien joué. Ce duel a tourné grâce à une IA qu’il faut payer à chaque proposition.';
  }
  return 'Content que ça te plaise. Chaque proposition évaluée coûte quelques centimes — le jeu tient grâce à ceux qui donnent.';
}

export default function SupportPrompt({ contexte = 'solo', serie = 0 }) {
  const { isPremium, stats } = useAuth();
  const partiesJouees = stats?.daysCompleted ?? 0;

  // La décision est prise une fois, à l'initialisation : sans cela, un
  // simple re-rendu ferait réapparaître l'encart après un refus.
  const [visible, setVisible] = useState(() => autorise({ isPremium, partiesJouees }));

  // L'affichage est mémorisé dans un effet, jamais pendant le rendu :
  // c'est lui qui fait courir le délai avant la prochaine sollicitation.
  useEffect(() => {
    if (visible) ecrire({ ...lire(), vuLe: Date.now() });
  }, [visible]);

  if (!visible) return null;

  const refuser = () => {
    const etat = lire();
    ecrire({ ...etat, refus: (etat.refus || 0) + 1, vuLe: Date.now() });
    setVisible(false);
  };

  return (
    <div className="support-prompt">
      <span className="support-prompt-icon">
        <Icon name="heart" size={17} />
      </span>

      <div className="grow">
        <p className="support-prompt-text">{messagePour(contexte, serie)}</p>
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          <Link to="/soutenir" className="btn btn-sm">
            Soutenir le jeu
          </Link>
          <button className="btn btn-ghost btn-sm" onClick={refuser}>
            Plus tard
          </button>
        </div>
      </div>
    </div>
  );
}
