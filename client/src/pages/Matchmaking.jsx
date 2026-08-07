import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSocket } from '../lib/socket.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { publierCredits, useCredits } from '../lib/credits.js';
import Icon from '../components/Icon.jsx';
import PremiumModal from '../components/PremiumModal.jsx';

/**
 * Écran de matchmaking : recherche aléatoire ou défi entre amis par code.
 * Dès qu'un adversaire est trouvé → décompte puis redirection vers l'arène.
 *
 * Deux tarifs, et il faut les annoncer avant le clic parce qu'ils diffèrent :
 * la file aléatoire coûte une partie, chacun la sienne ; l'invitation en
 * coûte deux à celui qui l'envoie, parce qu'il offre celle de son invité.
 * C'est le seul chemin par lequel on peut jouer sans rien dépenser, et il
 * est payé par quelqu'un — autant que ce quelqu'un le sache d'avance.
 *
 * Le solde est lu avant le premier clic : un bouton qui échoue vaut moins
 * qu'un bouton qui explique. Le refus, lui, reste tranché par le serveur au
 * moment de former le salon.
 */
export default function Matchmaking() {
  const navigate = useNavigate();
  const { user, isPremium, credits: duProfil } = useAuth();
  const [mode, setMode] = useState('idle'); // idle | searching | invited | found
  const [code, setCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(null);
  const [opponent, setOpponent] = useState(null);
  const [stockAtteint, setStockAtteint] = useState(false);

  const { data: quota, refetch: relireQuota } = useQuery({
    queryKey: ['duel-quota'],
    queryFn: async () => (await api.get('/duel/quota')).data,
  });

  // Le solde commun, tenu à jour par les parties jouées ailleurs. Le quota
  // renvoyé par la route en porte un plus frais dès qu'il arrive.
  const credits = useCredits(duProfil);
  const solde = quota?.balance ?? credits?.balance ?? 0;

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
    /*
     * Le serveur a refusé le duel faute de crédits : plus rien à chercher.
     *
     * Le solde arrive avec le refus — on le publie tout de suite, pour que
     * l'en-tête et cette page cessent d'annoncer un stock qui n'existe plus.
     * La fenêtre de montée en gamme ne s'ouvre que pour la formule Accès :
     * l'Illimité à zéro n'a rien à acheter, il a une date à attendre.
     */
    const onQuota = (etat) => {
      setMode('idle');
      publierCredits(etat);
      if (!isPremium) setStockAtteint(true);
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
  }, [user?.id, relireQuota, isPremium]);

  // Le solde renvoyé par la route de duel est le plus frais qu'on ait :
  // il vient d'être relu en base, quota compris.
  useEffect(() => {
    if (quota) publierCredits(quota);
  }, [quota]);

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
  const coutDuel = quota?.cost ?? 1;
  const coutInvite = quota?.inviteCost ?? 2;
  // Deux seuils, parce qu'il y a deux tarifs : on peut avoir de quoi entrer
  // dans la file sans avoir de quoi inviter.
  const peutJouer = quota?.canQueue ?? solde >= coutDuel;
  const peutInviter = quota?.canInvite ?? solde >= coutInvite;
  const recharge = quota?.nextRecharge
    ? new Date(quota.nextRecharge).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
    : null;

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <PremiumModal
        open={stockAtteint}
        onClose={() => setStockAtteint(false)}
        titre="Plus de parties"
        texte={`Un duel, ce sont deux joueurs et jusqu'à 15 propositions chacun, toutes évaluées
                par l'IA : il se paie comme une partie. Ton stock du mois est épuisé${
                  recharge ? ` et se recharge le ${recharge}` : ''
                }. La formule Illimité en donne près de quatre fois plus.`}
      />

      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Mode duel</h1>
      <p className="muted" style={{ marginBottom: 14 }}>
        Vous cherchez le même joueur mystère, chacun son tour, avec 15 essais chacun. Le premier à
        donner son nom gagne — si personne ne le trouve, c'est match nul.
      </p>

      <p className="small muted" style={{ marginBottom: 22 }}>
        <Icon name="swords" size={13} />{' '}
        {peutJouer ? (
          <>
            <strong className="mono">{solde}</strong> partie{solde > 1 ? 's' : ''} en stock — un duel
            en coûte {coutDuel}, une invitation {coutInvite} (tu offres celle de ton adversaire).
          </>
        ) : (
          <>
            Plus de parties en stock{recharge ? ` — recharge le ${recharge}` : ''}. Répondre à
            l'invitation de quelqu'un d'autre, en revanche, ne te coûte rien.{' '}
            {!isPremium && (
              <button className="btn-icon btn-text" onClick={() => setStockAtteint(true)}>
                Voir l’Illimité
              </button>
            )}
          </>
        )}
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
              On te met en relation avec un autre joueur en ligne. Chacun paie sa partie —{' '}
              {coutDuel} de ton stock, et rien tant qu'aucun adversaire n'est trouvé.
            </p>
            <button className="btn btn-block btn-lg" onClick={search} disabled={!peutJouer}>
              <Icon name="dice" size={19} /> Chercher un adversaire
            </button>
          </div>

          <div className="card">
            <h2 style={{ fontSize: 18, marginBottom: 6 }}>Défier un ami</h2>
            <p className="muted small" style={{ marginBottom: 16 }}>
              Génère un code, envoie-le : la partie démarre dès qu’il te rejoint. L'invitation
              coûte {coutInvite} parties — tu paies la tienne et celle de ton invité, qui n'a
              besoin de rien pour répondre.
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
              <button
                className="btn btn-ghost btn-block"
                onClick={createInvite}
                disabled={!peutInviter}
              >
                <Icon name="link" /> Créer une invitation
              </button>
            )}

            {/*
              Rejoindre reste ouvert même à zéro, et ce n'est pas un oubli :
              l'invité ne paie rien, c'est l'hôte qui règle les deux parties.
              Griser ce champ fermerait la seule porte par laquelle on peut
              faire jouer quelqu'un dont le stock est vide.
            */}
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
            <p className="small faint" style={{ margin: '8px 0 0' }}>
              Répondre à une invitation est gratuit : c'est celui qui invite qui paie.
            </p>
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
