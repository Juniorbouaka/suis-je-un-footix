import Icon from './Icon.jsx';

/**
 * Petit cœur à côté d'un pseudo, pour qui a soutenu le jeu.
 *
 * Décoratif, comme la couronne premium : il n'entre dans aucun tri ni
 * dans aucune règle de jeu. Contrairement au premium, il n'expire jamais
 * — un merci ne se retire pas.
 */
export default function SupporterBadge({ size = 12, title = 'A soutenu le jeu' }) {
  return (
    <span className="supporter-badge" title={title}>
      <Icon name="heart" size={size} strokeWidth={2.2} />
      <span className="sr-only">{title}</span>
    </span>
  );
}
