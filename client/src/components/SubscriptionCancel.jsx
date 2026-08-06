import { useState } from 'react';
import { api, errorMessage } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Icon from './Icon.jsx';

/**
 * Résilier son abonnement, en bas du profil.
 *
 * La résiliation existait déjà, mais sous la forme d'un petit bouton fantôme
 * dans la carte d'abonnement, en haut de page, à côté de la date d'échéance.
 * Un joueur qui veut partir cherche en bas — c'est là qu'on range ce qui
 * engage — et ne le trouvait pas. Une résiliation qu'on ne trouve pas est une
 * résiliation qu'on obtient en écrivant un mail énervé.
 *
 * Elle a donc sa propre section, à l'endroit où on la cherche, avec ce qu'il
 * faut savoir écrit noir sur blanc AVANT le clic : ce qu'on garde, jusqu'à
 * quand, et ce qui n'est pas remboursé.
 *
 * Ce n'est pas une zone de danger, et le rouge serait déplacé : rien n'est
 * détruit, rien n'est irréversible, on peut se réabonner le lendemain. La
 * suppression de compte, juste en dessous, est la seule chose qui mérite du
 * rouge sur cette page.
 */

/** Date lisible, sans l'heure : l'échéance est ce qui intéresse le joueur. */
function jour(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function SubscriptionCancel() {
  const { profile, isPremium, refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirme, setConfirme] = useState(false);

  const billing = profile?.billing;

  // Rien à résilier : compte gratuit.
  if (!isPremium) return null;

  const echeance = jour(billing?.premiumUntil);

  // Premium accordé à la main (administrateur, geste commercial) : aucun
  // prélèvement en cours, donc rien à arrêter. Le dire plutôt que de laisser
  // chercher un bouton qui n'existe pas.
  if (billing?.manual) {
    return (
      <section id="abonnement" className="card resiliation">
        <h2 style={{ fontSize: 16, marginBottom: 6 }}>Ton abonnement</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Ton accès premium a été accordé sans abonnement : rien n'est prélevé, il n'y a donc
          rien à résilier.
        </p>
      </section>
    );
  }

  const resilie = Boolean(billing?.cancelled);

  const resilier = async () => {
    setBusy(true);
    setError('');
    try {
      // Chaque prestataire résilie chez lui : on suit celui qui a encaissé.
      const route = billing?.provider === 'stripe' ? '/stripe/cancel' : '/billing/cancel';
      const { data } = await api.post(route);
      setMessage(data.message);
      setConfirme(false);
      await refreshProfile();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="abonnement" className="card resiliation">
      <h2 style={{ fontSize: 16, marginBottom: 6 }}>
        <Icon name="crown" size={15} /> Ton abonnement
      </h2>

      {resilie ? (
        <p className="muted small" style={{ margin: 0 }}>
          {echeance
            ? `Abonnement résilié. Rien ne sera plus prélevé, et tes avantages restent ouverts
               jusqu'au ${echeance}. Tu peux te réabonner quand tu veux.`
            : `Abonnement résilié. Rien ne sera plus prélevé. Tu peux te réabonner quand tu veux.`}
        </p>
      ) : (
        <>
          <p className="muted small" style={{ marginBottom: 14 }}>
            {billing?.plan === 'yearly' ? 'Formule annuelle' : 'Formule mensuelle'}
            {echeance ? `, prochaine échéance le ${echeance}` : ''}. Tu peux résilier à tout
            moment, sans justification et sans nous écrire.{' '}
            <strong>Rien n'est perdu&nbsp;:</strong> la période déjà payée va à son terme et tes
            avantages restent ouverts jusque-là. Aucun remboursement au prorata, aucun nouveau
            prélèvement ensuite.
          </p>

          {confirme ? (
            <div className="row wrap" style={{ gap: 10 }}>
              <button className="btn btn-danger" onClick={resilier} disabled={busy}>
                {busy ? 'Résiliation…' : 'Oui, résilier mon abonnement'}
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirme(false)} disabled={busy}>
                Annuler
              </button>
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirme(true)}>
              Résilier mon abonnement
            </button>
          )}
        </>
      )}

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
    </section>
  );
}
