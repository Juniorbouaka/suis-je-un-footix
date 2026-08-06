import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

/**
 * « Tu as fait le tour du forfait gratuit » : la seule fenêtre modale du jeu.
 *
 * L'invitation à soutenir (SupportPrompt) reste volontairement une carte
 * inline — on ne met pas un péage devant une victoire. Ici, c'est l'inverse :
 * le joueur vient de buter sur la limite du forfait gratuit, et la seule
 * chose qui l'intéresse à cet instant est justement de savoir comment en
 * avoir plus. Répondre ailleurs qu'à cet endroit, c'est ne pas répondre.
 *
 * Elle ne s'affiche qu'au moment où la limite tombe : recharger la page ne la
 * fait pas revenir.
 */

const AVANTAGES = [
  '50 chances par jour au lieu de 15',
  '20 duels par jour au lieu de 2',
  'Aucune publicité',
  'Toutes les archives, rejouables',
  'Statistiques détaillées et thèmes de terrain',
];

export default function PremiumModal({ open, onClose, titre, texte, avantages = AVANTAGES }) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal center" role="dialog" aria-modal="true" aria-label={titre}>
        <span className="premium-modal-icon">
          <Icon name="crown" size={26} />
        </span>

        <h2 style={{ fontSize: 22, margin: '14px 0 6px' }}>{titre}</h2>
        <p className="muted small" style={{ margin: '0 0 18px' }}>
          {texte}
        </p>

        <ul className="premium-modal-list">
          {avantages.map((a) => (
            <li key={a}>
              <Icon name="check" size={15} /> {a}
            </li>
          ))}
        </ul>

        <Link to="/premium" className="btn btn-block btn-lg" onClick={onClose}>
          Découvrir l'abonnement
        </Link>
        <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onClose}>
          Non merci, je reviens demain
        </button>
      </div>
    </div>
  );
}
