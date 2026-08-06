import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSocket } from '../lib/socket.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Icon from '../components/Icon.jsx';
import PremiumModal from '../components/PremiumModal.jsx';

/**
 * Écran de matchmaking : recherche aléatoire ou défi entre amis par code.
 * Dès qu'un adversaire est trouvé → décompte puis redirection vers l'arène.
 *
 * Le quota du jour est lu avant le premier clic : un bouton qui échoue vaut
 * moins qu'un bouton qui explique. Le refus, lui, reste tranché par le
 * serveur au moment de lancer la partie.
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
  const [quotaAtteint, setQuotaAtteint] = useState(false);

  const { data: quota, refetch: relireQuota } = useQuery({
    queryKey: ['duel-quota'],
    queryFn: async () => (await api.get('/duel/quota')).data,
  });

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
    // Le serveur a refusé le duel : plus rien à chercher, on explique.
    const onQuota = () => {
      setMode('idle');
      setQuotaAtteint(true);
      relireQuota();
    };

    socket.on('matchmaking-waiting', onWaiting);
    socket.on('invite-created', onInvite);
    socket.on('match-found', onFound);
    socket.on('error-message', onError);
    socket.on('duel-quota', onQuota);

    return () => {
      socket.off('matchmaking-waiting', onWaiting);
      socket.off('invite-created', onInvite);
      socket.off('match-found', onFound);
      socket.off('error-message', onError);
      socket.off('duel-quota', onQuota);
    };
  }, [user?.id, relireQuota]);

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
  const restants = quota?.remaining ?? null;
  const aSec = restants === 0;

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <PremiumModal
        open={quotaAtteint}
        onClose={() => setQuotaAtteint(false)}
        titre="Tes duels du jour sont joués"
        texte={`Le gratuit donne ${quota?.freeMax ?? 2} duels par jour — un duel, ce sont deux
                joueurs et jusqu'à 20 propositions chacun, tout ça évalué par l'IA. L'abonnement
                monte à ${quota?.premiumMax ?? 20} duels quotidiens.`}
      />

      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Mode duel</h1>
      <p className="muted" style={{ marginBottom: 14 }}>
        Vous cherchez le même joueur mystère, chacun son tour. Le premier à donner son nom gagne.
      </p>

      {restants !== null && (
        <p className="small muted" style={{ marginBottom: 22 }}>
          <Icon name="swords" size={13} />{' '}
          {aSec ? (
            <>
              Plus de duel aujourd’hui.{' '}
              <button className="btn-icon btn-text" onClick={() => setQuotaAtteint(true)}>
                Voir l’abonnement
              </button>
            </>
          ) : (
            <>
              <strong className="mono">{restants}</strong> duel(s) restant(s) aujourd’hui, sur{' '}
              {quota?.max}
            </>
          )}
        </p>
      )}

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
            <button className="btn btn-block btn-lg" onClick={search} disabled={aSec}>
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
              <button className="btn btn-ghost btn-block" onClick={createInvite} disabled={aSec}>
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
              <button className="btn" disabled={joinCode.length < 4 || aSec}>
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
