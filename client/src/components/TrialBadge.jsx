import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import Icon from './Icon.jsx';

/**
 * Ce qu'il reste de l'essai, en permanence dans l'en-tête.
 *
 * Même raison d'être que `CreditBadge`, et le même principe : un compteur
 * qu'on ne découvre qu'au moment où il bloque n'est pas un compteur, c'est
 * un piège. Celui-ci descend sous les yeux du joueur — huit, sept, six — et
 * quand il arrive à deux, l'idée de s'abonner n'est plus une interruption
 * mais une décision qu'il a vue venir.
 *
 * Il ne s'affiche QUE pendant l'essai. Un abonné voit son solde de parties à
 * la place, et un essai déjà épuisé n'a plus rien à compter : l'en-tête
 * repasse alors sur « S'abonner », qui est la seule chose à faire.
 *
 * Il mène à l'offre, comme le badge de solde : quand un compteur fond, la
 * question suivante est « et après ? », et la réponse doit être à un clic.
 */
export default function TrialBadge() {
  const { hasAccess, trial } = useAuth();

  if (hasAccess || !trial?.active) return null;

  const reste = trial.remaining;
  // Sous un quart de l'essai, la pastille passe au rouge. Ce n'est pas de la
  // décoration : c'est le moment où l'information devient une échéance.
  const bientot = reste <= Math.max(1, Math.round(trial.total / 4));

  return (
    <Link
      to="/premium"
      className={`pill credit-pill${bientot ? ' credit-pill-empty' : ''}`}
      title={`Essai gratuit : ${reste} chance(s) sur ${trial.total}, puis l'abonnement prend le relais.`}
    >
      <Icon name="gift" size={13} />
      <strong className="mono">{reste}</strong>
      <span className="hide-sm">chance{reste > 1 ? 's' : ''} d'essai</span>
    </Link>
  );
}
