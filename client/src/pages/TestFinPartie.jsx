import { useState } from 'react';
import { Link } from 'react-router-dom';
import Confetti from '../components/Confetti.jsx';
import Icon from '../components/Icon.jsx';
import ResultCard from '../components/ResultCard.jsx';
import ReplayModal from '../components/ReplayModal.jsx';

/**
 * Page de test : l'écran de fin de partie et sa fenêtre « Envie de rejouer ? ».
 *
 * Pourquoi une page pour ça : cet écran n'apparaît qu'une fois par jour et
 * par compte, à la fin d'une partie qu'il faut d'abord jouer — et dans trois
 * états qu'on ne choisit pas (gagné, chances épuisées, abandon). Le régler
 * en conditions réelles demandait donc plusieurs jours et plusieurs comptes.
 *
 * Rien n'est simulé du côté de l'affichage : c'est le composant ResultCard
 * du vrai jeu, avec le vrai pop-up. Seules les DONNÉES sont inventées.
 * Une maquette séparée finirait par diverger de l'écran qu'elle imite.
 *
 * Aucun appel réseau, aucun compte requis : la page est inoffensive, elle ne
 * peut ni fausser une partie ni toucher au classement.
 */

const GUESSES = [
  { word: 'Milan AC', score: 41, tier: 'cool', attempt: 1 },
  { word: 'Italie', score: 58, tier: 'warm', attempt: 2 },
  { word: 'défenseur central', score: 72, tier: 'hot', attempt: 3 },
  { word: 'Ballon d’or 2006', score: 84, tier: 'blazing', attempt: 4 },
  { word: 'Fabio Cannavaro', score: 100, tier: 'found', attempt: 5 },
];

const DESCRIPTION =
  "Défenseur central italien, capitaine de la sélection championne du monde en 2006 et " +
  "Ballon d'or la même année — le seul défenseur à l'avoir obtenu depuis Matthias Sammer.";

const MEDAILLES = [
  { code: 'sharp', name: 'Œil de lynx', description: 'Trouvé en moins de 6 tentatives.' },
  { code: 'streak7', name: 'Semaine parfaite', description: '7 jours d’affilée.' },
];

/* Les trois fins possibles d'une partie solo. */
const ISSUES = [
  { key: 'found', label: 'Trouvé', attempts: 5, seconds: 214, score: 780 },
  { key: 'exhausted', label: 'Chances épuisées', attempts: 15, seconds: 631, score: 0 },
  { key: 'surrendered', label: 'Abandon', attempts: 4, seconds: 96, score: 0 },
];

export default function TestFinPartie() {
  const [issue, setIssue] = useState('found');
  const [premium, setPremium] = useState(false);
  // Le solde décide de tout sur cet écran : au-dessus de zéro on propose de
  // rejouer, à zéro on annonce la recharge — et la fenêtre ne s'ouvre que là.
  const [restantes, setRestantes] = useState(3);
  // Change à chaque relance : remonter la fenêtre revient à la recréer.
  const [cle, setCle] = useState(0);
  const [popup, setPopup] = useState(true);

  const modele = ISSUES.find((i) => i.key === issue);
  const guesses = GUESSES.slice(0, Math.min(GUESSES.length, modele.attempts));

  // Un portefeuille inventé, de la même forme que celui du serveur : les
  // composants ne doivent pas savoir qu'ils sont sur une page de test.
  const portefeuille = {
    balance: restantes,
    monthly: premium ? 75 : 20,
    nextRecharge: '2026-09-01T00:00:00.000Z',
    costs: { solo: 1, duel: 1, duelInvite: 2 },
  };

  const result = {
    attempts: modele.attempts,
    seconds: modele.seconds,
    score: modele.score,
    outcome: issue,
    word: 'Fabio Cannavaro',
  };

  const relancer = () => {
    setPopup(false);
    setCle((n) => n + 1);
    // Un tour de boucle suffit pour que React démonte l'ancienne fenêtre.
    setTimeout(() => setPopup(true), 0);
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="test-banner">
        <span className="test-banner-tag">Page de test</span>
        <span className="small">
          Écran de fin de partie et fenêtre « Envie de rejouer ? ». Données inventées, aucun appel
          au serveur — rien de ce qui est affiché ici ne compte.
        </span>
      </div>

      <div className="card card-tight" style={{ marginBottom: 16 }}>
        <div className="stack-sm">
          <div>
            <div className="small muted" style={{ marginBottom: 6, fontWeight: 650 }}>
              Issue de la partie
            </div>
            <div className="tabs" style={{ marginBottom: 0 }}>
              {ISSUES.map((i) => (
                <button
                  key={i.key}
                  className={`tab${issue === i.key ? ' active' : ''}`}
                  onClick={() => setIssue(i.key)}
                >
                  {i.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="small muted" style={{ marginBottom: 6, fontWeight: 650 }}>
              Forfait du joueur
            </div>
            <div className="tabs" style={{ marginBottom: 0 }}>
              <button className={`tab${premium ? '' : ' active'}`} onClick={() => setPremium(false)}>
                Accès — le pop-up s’affiche à zéro
              </button>
              <button className={`tab${premium ? ' active' : ''}`} onClick={() => setPremium(true)}>
                Illimité — jamais de pop-up
              </button>
            </div>
          </div>

          <div>
            <div className="small muted" style={{ marginBottom: 6, fontWeight: 650 }}>
              Parties restantes au stock
            </div>
            <div className="tabs" style={{ marginBottom: 0 }}>
              {[12, 1, 0].map((n) => (
                <button
                  key={n}
                  className={`tab${restantes === n ? ' active' : ''}`}
                  onClick={() => setRestantes(n)}
                >
                  {n === 0 ? 'aucune' : `${n} restante${n > 1 ? 's' : ''}`}
                </button>
              ))}
            </div>
          </div>

          <div className="row wrap" style={{ gap: 10 }}>
            <button className="btn btn-sm" onClick={relancer} disabled={premium}>
              <Icon name="repeat" size={14} /> Rejouer le pop-up
            </button>
            <Link to="/" className="btn btn-ghost btn-sm">
              Retour au jeu
            </Link>
          </div>

          {premium ? (
            <p className="small faint" style={{ margin: 0 }}>
              Un abonné Illimité ne voit jamais cette fenêtre : il a déjà ce qu'elle vend. À zéro,
              l'encart lui annonce simplement sa date de recharge.
            </p>
          ) : (
            restantes > 0 && (
              <p className="small faint" style={{ margin: 0 }}>
                Tant qu'il reste des parties, la fenêtre ne s'ouvre pas d'elle-même : il n'y a rien
                à proposer à quelqu'un qui peut déjà rejouer. Le bouton ci-dessus la force.
              </p>
            )
          )}
        </div>
      </div>

      {issue === 'found' && <Confetti />}

      {popup && (
        <ReplayModal
          key={cle}
          outcome={issue}
          isPremium={premium}
          credits={portefeuille}
          // Les règles « une fois par jour » et « seulement à zéro » sont
          // court-circuitées ici, sinon la page ne montrerait rien dès la
          // deuxième visite.
          force={!premium}
          onClose={() => setPopup(false)}
        />
      )}

      <ResultCard
        result={result}
        description={DESCRIPTION}
        guesses={guesses}
        unlocked={issue === 'found' ? MEDAILLES : []}
        puzzleNumber={212}
        maxAttempts={15}
        isPremium={premium}
        credits={portefeuille}
        serie={issue === 'found' ? 7 : 0}
        forcerSoutien
      />
    </div>
  );
}
