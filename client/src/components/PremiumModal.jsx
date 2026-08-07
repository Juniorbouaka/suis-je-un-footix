import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

/**
 * La fenêtre qui propose de monter en gamme — la seule fenêtre modale du jeu.
 *
 * Elle ne s'adresse QU'À des abonnés : depuis que le jeu est payant, celui
 * qui la voit a déjà sorti sa carte. Lui vendre « l'abonnement » serait donc
 * absurde ; ce qu'on lui propose, c'est un stock plus grand, au moment précis
 * où le sien vient de manquer.
 *
 * Deux règles de politesse tiennent tout l'écran : une seule fois par jour
 * (la fréquence est gérée par l'appelant), et un refus qui se dit en clair,
 * pas une croix minuscule dans un coin.
 */

const AVANTAGES = [
  '75 parties par mois au lieu de 20',
  'Aucune publicité, nulle part',
  'Statistiques détaillées et historique complet',
  'Quatre thèmes de terrain supplémentaires',
];

export default function PremiumModal({
  open,
  onClose,
  titre,
  texte,
  avantages = AVANTAGES,
  kicker = null,
  cta = 'Voir les formules',
  dismiss = 'Non merci, ça ira',
  note = null,
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal center" role="dialog" aria-modal="true" aria-label={titre}>
        <span className="premium-modal-icon">
          <Icon name="crown" size={26} />
        </span>

        {kicker && <div className="premium-modal-kicker">{kicker}</div>}

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
          {cta}
        </Link>
        <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onClose}>
          {dismiss}
        </button>

        {note && (
          <p className="small faint" style={{ margin: '12px 0 0' }}>
            {note}
          </p>
        )}
      </div>
    </div>
  );
}
