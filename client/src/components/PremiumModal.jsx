import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

/**
 * La fenêtre qui propose l'abonnement — la seule fenêtre modale du jeu.
 *
 * L'invitation à soutenir (SupportPrompt) reste volontairement une carte
 * inline : on ne met pas un péage devant une victoire. Ici, c'est l'inverse.
 * Elle n'apparaît qu'à la fin d'une partie, au moment précis où le joueur se
 * demande ce qu'il fait ensuite — et la réponse honnête, en gratuit, est
 * « tu attends minuit ». Répondre ailleurs qu'à cet endroit, c'est ne pas
 * répondre.
 *
 * Deux règles de politesse tiennent tout l'écran : une seule fois par jour
 * (la fréquence est gérée par l'appelant), et un refus qui se dit en clair,
 * pas une croix minuscule dans un coin.
 */

const AVANTAGES = [
  '5 parties par jour au lieu d’une',
  '50 chances par jour au lieu de 15',
  '5 duels par jour au lieu d’un seul',
  'Aucune publicité',
  'Toutes les archives, statistiques détaillées',
];

export default function PremiumModal({
  open,
  onClose,
  titre,
  texte,
  avantages = AVANTAGES,
  kicker = null,
  cta = "Découvrir l'abonnement",
  dismiss = 'Non merci, je reviens demain',
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
