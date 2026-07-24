import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../lib/socket.js';
import { useAuth } from '../lib/auth.jsx';
import Icon from '../components/Icon.jsx';

/**
 * Écran de matchmaking : recherche aléatoire ou défi entre amis par code.
 * Dès qu'un adversaire est trouvé → décompte puis redirection vers l'arène.
 */
export default function Matchmaking() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mode, setMode] = useState('idle'); // idle | searching | invited | found
  const [code, setCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(null);
  const [opponent, setOpponent] = useState(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onWaiting = () => setMode('searching');
    const onInvite = ({ code: c }) => {
      setCode(c);
      setMode('invited');
    };
    const onFound = (state) => {
      setMode('found');
      setOpponent(state.players?.find((p) => p.userId !== user?.id) || null);
      setCountdown(3);
    };
    const onError = ({ error: e }) => setError(e);

    socket.on('matchmaking-waiting', onWaiting);
    socket.on('invite-created', onInvite);
    socket.on('match-found', onFound);
    socket.on('error-message', onError);

    return () => {
      socket.off('matchmaking-waiting', onWaiting);
      socket.off('invite-created', onInvite);
      socket.off('match-found', onFound);
      socket.off('error-message', onError);
    };
  }, [user?.id]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      navigate('/duel/partie');
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, navigate]);

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('code');
    if (param) setJoinCode(param.toUpperCase());
  }, []);

  const search = () => {
    setError('');
    getSocket()?.emit('join-matchmaking');
    setMode('searching');
  };

  const cancel = () => {
    getSocket()?.emit('cancel-matchmaking');
    setMode('idle');
  };

  const createInvite = () => {
    setError('');
    getSocket()?.emit('create-invite');
  };

  const join = (e) => {
    e.preventDefault();
    setError('');
    getSocket()?.emit('join-invite', { code: joinCode.trim().toUpperCase() });
  };

  const inviteUrl = code ? `${window.location.origin}/duel?code=${code}` : '';

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Mode duel</h1>
      <p className="muted" style={{ marginBottom: 22 }}>
        Chacun choisit un joueur secret. Le premier à deviner celui de l’adversaire gagne.
      </p>

      {mode === 'found' ? (
        <div className="card center">
          <div className="result-icon">
            <Icon name="swords" size={40} strokeWidth={1.5} />
          </div>
          <h2 style={{ fontSize: 22, margin: '10px 0 4px' }}>Adversaire trouvé</h2>
          <p className="muted">{opponent?.username ? `Face à ${opponent.username}` : 'Prépare-toi'}</p>
          <div className="gauge-value tier-blazing" style={{ marginTop: 14 }}>
            {countdown}
          </div>
        </div>
      ) : mode === 'searching' ? (
        <div className="card center">
          <div className="spinner" />
          <h2 style={{ fontSize: 19, margin: '16px 0 4px' }}>
            Recherche d’un adversaire<span className="dots" />
          </h2>
          <p className="muted small">Reste sur cette page, ça ne prend qu’un instant.</p>
          <button className="btn btn-ghost" style={{ marginTop: 18 }} onClick={cancel}>
            Annuler
          </button>
        </div>
      ) : (
        <div className="stack">
          <div className="card">
            <h2 style={{ fontSize: 18, marginBottom: 6 }}>Adversaire aléatoire</h2>
            <p className="muted small" style={{ marginBottom: 16 }}>
              On te met en relation avec un autre joueur en ligne.
            </p>
            <button className="btn btn-block btn-lg" onClick={search}>
              <Icon name="dice" size={19} /> Chercher un adversaire
            </button>
          </div>

          <div className="card">
            <h2 style={{ fontSize: 18, marginBottom: 6 }}>Défier un ami</h2>
            <p className="muted small" style={{ marginBottom: 16 }}>
              Génère un code, envoie-le : la partie démarre dès qu’il te rejoint.
            </p>

            {mode === 'invited' ? (
              <div className="stack-sm">
                <div className="alert alert-info">
                  Ton code : <strong className="mono" style={{ fontSize: 18 }}>{code}</strong>
                </div>
                <button
                  className="btn btn-ghost btn-block"
                  onClick={() => navigator.clipboard?.writeText(inviteUrl)}
                >
                  <Icon name="copy" /> Copier le lien d’invitation
                </button>
                <p className="small muted center">
                  En attente de ton ami<span className="dots" />
                </p>
              </div>
            ) : (
              <button className="btn btn-ghost btn-block" onClick={createInvite}>
                <Icon name="link" /> Créer une invitation
              </button>
            )}

            <form onSubmit={join} className="guess-form" style={{ marginTop: 14 }}>
              <input
                className="input mono"
                placeholder="Code reçu (ex. A1B2C3)"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
                aria-label="Code d’invitation"
              />
              <button className="btn" disabled={joinCode.length < 4}>
                Rejoindre
              </button>
            </form>
          </div>
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}
    </div>
  );
}
