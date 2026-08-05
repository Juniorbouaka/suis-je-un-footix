import Icon from './Icon.jsx';

/**
 * Petite couronne à côté d'un pseudo.
 *
 * Purement décoratif : le badge n'entre dans aucun tri ni dans aucune règle
 * de jeu. Il rend juste l'abonnement visible, ce qui est sa raison d'être.
 */
export default function PremiumBadge({ size = 13, title = 'Compte premium' }) {
  return (
    <span className="premium-badge" title={title}>
      <Icon name="crown" size={size} strokeWidth={2} />
      <span className="sr-only">{title}</span>
    </span>
  );
}
