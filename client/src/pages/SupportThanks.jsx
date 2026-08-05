import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.js';
import Confetti from '../components/Confetti.jsx';
import Icon from '../components/Icon.jsx';

/**
 * Retour de PayPal après un don.
 *
 * PayPal renvoie l'identifiant de commande dans « token ». L'encaissement se
 * fait côté serveur, qui vérifie d'abord que la commande vient bien de chez
 * nous : on n'encaisse jamais une référence fournie par le navigateur.
 */
export default function SupportThanks() {
  const [params] = useSearchParams();
  const [state, setState] = useState('pending'); // pending | ok | error
  const [montant, setMontant] = useState(null);
  const [error, setError] = useState('');
  const fait = useRef(false);

  const orderId = params.get('token') || params.get('orderId');

  useEffect(() => {
    // React 18 monte deux fois en développement : sans ce garde, on
    // tenterait l'encaissement deux fois de suite.
    if (fait.current) return;
    fait.current = true;

    if (!orderId) {
      setState('error');
      setError("PayPal n'a pas transmis de référence de paiement.");
      return;
    }

    (async () => {
      try {
        const { data } = await api.post('/donate/capture', { orderId });
        setMontant(data.amount);
        setState(data.status === 'COMPLETED' ? 'ok' : 'error');
        if (data.status !== 'COMPLETED') setError(`Paiement non finalisé (${data.status}).`);
      } catch (err) {
        setState('error');
        setError(errorMessage(err));
      }
    })();
  }, [orderId]);

  if (state === 'pending') {
    return (
      <div className="card center" style={{ maxWidth: 460, margin: '60px auto' }}>
        <div className="spinner" />
        <p className="muted" style={{ marginTop: 14 }}>Finalisation du paiement…</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="card center" style={{ maxWidth: 500, margin: '60px auto' }}>
        <Icon name="alert" size={32} />
        <h1 style={{ fontSize: 21, margin: '12px 0 8px' }}>Paiement non abouti</h1>
        <p className="muted small">{error}</p>
        <p className="muted small" style={{ marginTop: 10 }}>
          Si une somme a été débitée, elle sera automatiquement restituée par PayPal sous quelques
          jours.
        </p>
        <div className="row" style={{ gap: 10, marginTop: 18, justifyContent: 'center' }}>
          <Link to="/soutenir" className="btn btn-ghost">Réessayer</Link>
          <Link to="/" className="btn">Retour au jeu</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card center" style={{ maxWidth: 500, margin: '60px auto' }}>
      <Confetti />
      <span className="don-hero-icon">
        <Icon name="heart" size={32} strokeWidth={1.6} />
      </span>
      <h1 style={{ fontSize: 25, margin: '14px 0 8px' }}>Merci !</h1>
      <p className="muted">
        {montant ? `Ton don de ${montant} € est bien arrivé. ` : 'Ton don est bien arrivé. '}
        C'est ce qui fait tourner le jeu.
      </p>
      <div className="row wrap" style={{ gap: 10, marginTop: 20, justifyContent: 'center' }}>
        <Link to="/solo" className="btn">Jouer</Link>
        <Link to="/" className="btn btn-ghost">Accueil</Link>
      </div>
    </div>
  );
}
