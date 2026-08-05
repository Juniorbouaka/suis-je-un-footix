import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.js';
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
 * L'abonnement, vu du profil.
 *
 * Une résiliation ne coupe rien sur le champ : la période payée va à son
 * terme. Le libellé doit le dire clairement, sinon le joueur croit avoir
 * perdu ce qu'il a payé et vient se plaindre.
 */
export default function SubscriptionCard() {
  const { profile, isPremium, refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const billing = profile?.billing;

  const resilier = async () => {
    if (
      !window.confirm(
        "Résilier ton abonnement ? Tes avantages restent actifs jusqu'à la fin de la période déjà payée."
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Chaque prestataire resilie chez lui : on suit celui qui a encaisse.
      const route = billing?.provider === 'stripe' ? '/stripe/cancel' : '/billing/cancel';
      const { data } = await api.post(route);
      setMessage(data.message);
      await refreshProfile();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

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

        {!resilie && (
          <button className="btn btn-ghost btn-sm" onClick={resilier} disabled={busy}>
            {busy ? 'Résiliation…' : 'Résilier'}
          </button>
        )}
      </div>

      {message && (
        <div className="alert alert-info" style={{ marginTop: 12 }}>
          {message}
        </div>
      )}
      {error && (
        <div className="alert alert-error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}
