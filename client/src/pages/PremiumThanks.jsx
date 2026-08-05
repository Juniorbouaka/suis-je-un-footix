import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Confetti from '../components/Confetti.jsx';
import Icon from '../components/Icon.jsx';

/**
 * Retour de PayPal après approbation.
 *
 * Le webhook fait foi, mais il peut arriver quelques secondes plus tard :
 * on confirme donc ici pour ouvrir les droits tout de suite. Le client ne
 * décide de rien — c'est le serveur qui interroge PayPal.
 */
export default function PremiumThanks() {
  const [params] = useSearchParams();
  const { refreshProfile } = useAuth();
  const [state, setState] = useState('pending'); // pending | ok | error
  const [error, setError] = useState('');
  const done = useRef(false);

  // PayPal renvoie « subscription_id », Stripe « session_id » : une seule
  // page de retour sert aux deux.
  const subscriptionId = params.get('subscription_id');
  const sessionId = params.get('session_id');

  useEffect(() => {
    // React 18 monte deux fois en développement : sans ce garde, on
    // confirmerait l'abonnement deux fois de suite.
    if (done.current) return;
    done.current = true;

    if (!subscriptionId && !sessionId) {
      setState('error');
      setError("Aucun identifiant de paiement n'a été transmis.");
      return;
    }

    (async () => {
      try {
        if (sessionId) await api.post('/stripe/confirm', { sessionId });
        else await api.post('/billing/confirm', { subscriptionId });
        await refreshProfile();
        setState('ok');
      } catch (err) {
        setState('error');
        setError(errorMessage(err));
      }
    })();
  }, [subscriptionId, sessionId, refreshProfile]);

  if (state === 'pending') {
    return (
      <div className="card center" style={{ maxWidth: 480, margin: '60px auto' }}>
        <div className="spinner" />
        <p className="muted" style={{ marginTop: 14 }}>
          Vérification du paiement auprès de PayPal…
        </p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="card center" style={{ maxWidth: 520, margin: '60px auto' }}>
        <Icon name="alert" size={34} />
        <h1 style={{ fontSize: 21, margin: '12px 0 8px' }}>Confirmation impossible</h1>
        <p className="muted small">{error}</p>
        <p className="muted small" style={{ marginTop: 12 }}>
          Si le paiement a bien été prélevé, tes droits s'ouvriront automatiquement d'ici quelques
          minutes — le prestataire nous prévient de son côté. Sinon, rien n'a été débité.
        </p>
        <div className="row" style={{ gap: 10, marginTop: 18, justifyContent: 'center' }}>
          <Link to="/premium" className="btn btn-ghost">
            Retour à l'offre
          </Link>
          <Link to="/profil" className="btn">
            Mon profil
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card center" style={{ maxWidth: 520, margin: '60px auto' }}>
      <Confetti />
      <span className="premium-hero-icon">
        <Icon name="crown" size={38} strokeWidth={1.6} />
      </span>
      <h1 style={{ fontSize: 25, margin: '14px 0 8px' }}>Bienvenue chez les abonnés</h1>
      <p className="muted">
        Merci — c'est ce qui fait tourner le jeu. Les archives, les statistiques et les thèmes sont
        ouverts.
      </p>
      <div className="row wrap" style={{ gap: 10, marginTop: 20, justifyContent: 'center' }}>
        <Link to="/archives" className="btn">
          <Icon name="book" /> Explorer les archives
        </Link>
        <Link to="/profil" className="btn btn-ghost">
          Mes statistiques
        </Link>
      </div>
    </div>
  );
}
