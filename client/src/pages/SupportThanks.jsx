import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.js';
import Confetti from '../components/Confetti.jsx';
import Icon from '../components/Icon.jsx';
import { marquerDonateur } from '../components/SupportPrompt.jsx';

/**
 * Retour de l'encaisseur après un don.
 *
 * Deux chemins arrivent ici, et on les reconnaît au paramètre d'URL :
 *
 *   — PayPal renvoie l'identifiant de commande dans « token » ;
 *   — Stripe (carte, Apple Pay, Google Pay) renvoie « session_id ».
 *
 * Dans les deux cas la vérification se fait côté serveur, qui contrôle
 * d'abord que la référence vient bien de chez nous : on n'entérine jamais
 * un identifiant fourni par le navigateur.
 */
export default function SupportThanks() {
  const [params] = useSearchParams();
  const [state, setState] = useState('pending'); // pending | ok | error
  const [montant, setMontant] = useState(null);
  const [error, setError] = useState('');
  const fait = useRef(false);

  const sessionId = params.get('session_id');
  const orderId = sessionId || params.get('token') || params.get('orderId');

  useEffect(() => {
    // React 18 monte deux fois en développement : sans ce garde, on
    // tenterait l'encaissement deux fois de suite.
    if (fait.current) return;
    fait.current = true;

    if (!orderId) {
      setState('error');
      setError("Aucune référence de paiement n'a été transmise.");
      return;
    }

    (async () => {
      try {
        const { data } = sessionId
          ? await api.post('/stripe/donate/confirm', { sessionId })
          : await api.post('/donate/capture', { orderId });
        setMontant(data.amount);
        // Il a donne : on ne le sollicitera plus jamais.
        if (data.status === 'COMPLETED') marquerDonateur();
        setState(data.status === 'COMPLETED' ? 'ok' : 'error');
        if (data.status !== 'COMPLETED') setError(`Paiement non finalisé (${data.status}).`);
      } catch (err) {
        setState('error');
        setError(errorMessage(err));
      }
    })();
  }, [orderId, sessionId]);

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
          Si une somme a été débitée, elle sera automatiquement restituée sous quelques jours.
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

      <SignerLeMur orderId={orderId} />

      <div className="row wrap" style={{ gap: 10, marginTop: 20, justifyContent: 'center' }}>
        <Link to="/solo" className="btn">Jouer</Link>
        <Link to="/soutenir" className="btn btn-ghost">Voir le mur</Link>
      </div>
    </div>
  );
}

/**
 * Proposition de figurer sur le mur des soutiens.
 *
 * L'anonymat est le défaut : il faut cliquer pour apparaître, jamais pour
 * disparaître. Personne ne doit se retrouver sur une page publique sans
 * l'avoir demandé.
 */
function SignerLeMur({ orderId }) {
  const [nom, setNom] = useState('');
  const [etat, setEtat] = useState('demande'); // demande | envoi | signe | refuse
  const [erreur, setErreur] = useState('');

  const envoyer = async (publier) => {
    setEtat('envoi');
    setErreur('');
    try {
      await api.post(`/donate/${orderId}/name`, { name: nom, public: publier });
      setEtat(publier ? 'signe' : 'refuse');
    } catch (err) {
      setErreur(errorMessage(err));
      setEtat('demande');
    }
  };

  if (etat === 'signe') {
    return (
      <div className="alert alert-success" style={{ marginTop: 18, textAlign: 'left' }}>
        Ton nom apparaît désormais sur le mur des soutiens.
      </div>
    );
  }

  if (etat === 'refuse') {
    return (
      <p className="small muted" style={{ marginTop: 18 }}>
        Ton don reste anonyme. Merci quand même !
      </p>
    );
  }

  return (
    <div className="signature" style={{ marginTop: 20 }}>
      <p className="small" style={{ margin: '0 0 10px' }}>
        Tu veux apparaître sur le <strong>mur des soutiens</strong> ? C'est facultatif, et le
        montant n'est jamais affiché.
      </p>

      <input
        className="input"
        value={nom}
        onChange={(e) => setNom(e.target.value)}
        placeholder="Ton pseudo (24 caractères max)"
        maxLength={24}
        aria-label="Nom affiché sur le mur"
      />

      {erreur && (
        <div className="alert alert-error" style={{ marginTop: 10 }}>
          {erreur}
        </div>
      )}

      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button
          className="btn btn-sm grow"
          disabled={!nom.trim() || etat === 'envoi'}
          onClick={() => envoyer(true)}
        >
          {etat === 'envoi' ? '…' : 'Signer le mur'}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={etat === 'envoi'}
          onClick={() => envoyer(false)}
        >
          Rester anonyme
        </button>
      </div>
    </div>
  );
}
