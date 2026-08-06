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
  const { profile, isPremium } = useAuth();

  const billing = profile?.billing;

  if (!isPremium) {
    return (
      <div className="card subscription-card" style={{ marginBottom: 18 }}>
        <div className="row row-between wrap" style={{ gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 18, marginBottom: 4 }}>Compte gratuit</h2>
            <p className="muted small" style={{ margin: 0 }}>
              Archives complètes, rejeu des journées passées, statistiques détaillées et thèmes.
            </p>
          </div>
          <Link to="/premium" className="btn">
            <Icon name="crown" size={15} /> Découvrir le premium
          </Link>
        </div>
      </div>
    );
  }

  const echeance = jour(billing?.premiumUntil);
  const resilie = billing?.cancelled;

  // Premium sans abonnement : rien à résilier, rien à facturer.
  if (billing?.manual) {
    return (
      <div className="card subscription-card premium" style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>
          <Icon name="crown" size={16} /> Accès premium
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          Accordé sans abonnement : tous les avantages sont ouverts, il n'y a rien à payer ni à
          résilier.
        </p>
      </div>
    );
  }

  return (
    <div className="card subscription-card premium" style={{ marginBottom: 18 }}>
      <div className="row row-between wrap" style={{ gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, marginBottom: 4 }}>
            <Icon name="crown" size={16} /> Abonné premium
          </h2>
          <p className="muted small" style={{ margin: 0 }}>
            {resilie
              ? echeance
                ? `Abonnement résilié — tes avantages courent jusqu'au ${echeance}.`
                : 'Abonnement résilié.'
              : billing?.plan === 'yearly'
                ? `Formule annuelle${echeance ? ` — prochaine échéance le ${echeance}` : ''}.`
                : `Formule mensuelle${echeance ? ` — prochaine échéance le ${echeance}` : ''}.`}
          </p>
        </div>

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
  );
}
