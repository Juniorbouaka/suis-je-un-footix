import { useState } from 'react';
import Icon from './Icon.jsx';

/**
 * Bouton de partage — le levier de croissance du jeu.
 * Le texte copié ne révèle JAMAIS le joueur : il montre la progression
 * des meilleurs scores sous forme de barres, façon grille Wordle.
 */

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function sparkline(guesses, max = 12) {
  if (!guesses.length) return '';
  // progression du meilleur score au fil des tentatives
  let best = 0;
  const curve = guesses.map((g) => (best = Math.max(best, g.score)));
  // on échantillonne pour garder une ligne courte et lisible
  const step = Math.max(1, Math.ceil(curve.length / max));
  const sampled = curve.filter((_, i) => i % step === 0 || i === curve.length - 1);
  return sampled.map((s) => BLOCKS[Math.min(7, Math.floor(s / 12.5))]).join('');
}

export function buildShareText({ puzzleNumber, attempts, score, guesses, outcome, maxAttempts }) {
  const lines = ['Suis-je un footix ? n°' + puzzleNumber];

  if (outcome === 'found') {
    lines.push(`Trouvé en ${attempts}/${maxAttempts} essais · ${score} pts`);
  } else if (outcome === 'exhausted') {
    lines.push(`Séché après ${attempts} essais — je suis un footix`);
  } else {
    lines.push(`Abandon après ${attempts} essais`);
  }

  const line = sparkline(guesses || []);
  if (line) lines.push(line);
  lines.push(window.location.origin);

  return lines.join('\n');
}

export default function ShareResult(props) {
  const [state, setState] = useState('idle'); // idle | copied | shared | error

  const share = async () => {
    const text = buildShareText(props);
    try {
      if (navigator.share) {
        await navigator.share({ text });
        setState('shared');
      } else {
        await navigator.clipboard.writeText(text);
        setState('copied');
      }
    } catch (err) {
      // l'utilisateur a annulé le partage natif : ce n'est pas une erreur
      if (err?.name === 'AbortError') return;
      setState('error');
    }
    setTimeout(() => setState('idle'), 2600);
  };

  return (
    <button className="btn btn-block" onClick={share} style={{ marginTop: 4 }}>
      <Icon name={state === 'copied' || state === 'shared' ? 'check' : 'copy'} />
      {state === 'copied'
        ? 'Copié — colle-le où tu veux'
        : state === 'shared'
          ? 'Partagé'
          : state === 'error'
            ? 'Copie impossible'
            : 'Partager mon résultat'}
    </button>
  );
}
