import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import Icon from './Icon.jsx';

/** Date lisible, sans l'heure : l'échéance est ce qui intéresse le joueur. */
function jour(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * L'abonnement, vu du profil — l'ÉTAT seulement.
 *
 * Formule, échéance, résiliation en cours : ce qu'on veut savoir d'un coup
 * d'œil en haut de page. Le bouton qui résilie vit dans SubscriptionCancel,
 * tout en bas, parce que c'est là qu'on va le chercher.
 *
 * Une résiliation ne coupe rien sur le champ : la période payée va à son
 * terme. Le libellé doit le dire clairement, sinon le joueur croit avoir
 * perdu ce qu'il a payé et vient se plaindre.
 */
export default function SubscriptionCard() {
  const { billing, hasAccess, isPremium, planLabel } = useAuth();

  /*
   * Sans abonnement, il n'y a plus de « compte gratuit » à décrire : il y a
   * un jeu fermé et un prix d'entrée. Dire les choses autrement ferait
   * espérer une version allégée qui n'existe pas.
   */
  if (!hasAccess) {
    return (
      <div className="card subscription-card" style={{ marginBottom: 18 }}>
        <div className="row row-between wrap" style={{ gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 18, marginBottom: 4 }}>Aucun abonnement</h2>
            <p className="muted small" style={{ margin: 0 }}>
              Jouer demande une formule : le joueur mystère du jour tous les jours, plus des
              parties supplémentaires chaque mois pour les archives et les duels.
            </p>
          </div>
          <Link to="/premium" className="btn">
            <Icon name="crown" size={15} /> Voir les formules
          </Link>
        </div>
      </div>
    );
  }

  const echeance = jour(billing?.premiumUntil);
  const resilie = billing?.cancelled;
  const formule = planLabel || (isPremium ? 'Illimité' : 'Accès');

  // Abonné sans abonnement : administrateur, ou geste accordé à la main.
  // Rien à facturer, rien à résilier — le profil doit le dire au lieu
  // d'inventer une échéance.
  if (billing?.manual) {
    return (
      <div className="card subscription-card premium" style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>
          <Icon name="crown" size={16} /> Accès offert
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          Accordé sans abonnement : tout est ouvert, il n'y a rien à payer ni à résilier. Ton stock
          de parties se recharge tous les mois.
        </p>
      </div>
    );
  }

  return (
    <div className="card subscription-card premium" style={{ marginBottom: 18 }}>
      <div className="row row-between wrap" style={{ gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, marginBottom: 4 }}>
            <Icon name="crown" size={16} /> Formule {formule}
          </h2>
          <p className="muted small" style={{ margin: 0 }}>
            {resilie
              ? echeance
                ? `Abonnement résilié — tu joues jusqu'au ${echeance}.`
                : 'Abonnement résilié.'
              : echeance
                ? `Prochaine échéance le ${echeance} — ton stock se recharge ce jour-là.`
                : 'Abonnement en cours.'}
          </p>
        </div>

        <div className="row wrap" style={{ gap: 8 }}>
          {/* La montée en gamme se propose ici et nulle part ailleurs sur
              cette page : un abonné qui vient consulter son profil n'est pas
              venu se faire vendre quelque chose. */}
          {!isPremium && !resilie && (
            <Link to="/premium" className="btn btn-sm">
              Passer à l'Illimité
            </Link>
          )}

          {/* L'ACTION vit en bas de page, dans sa propre section : c'est là
              qu'on cherche à résilier, et un geste qui engage ne doit pas
              exister à deux endroits — deux chemins, deux fois plus d'occasions
              qu'ils divergent. Ici, seulement un renvoi. */}
          {!resilie && (
            <a href="#abonnement" className="btn btn-ghost btn-sm">
              Gérer
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
