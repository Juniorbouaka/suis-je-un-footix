import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../lib/socket.js';
import { useAuth } from '../lib/auth.jsx';
import Gauge from '../components/Gauge.jsx';
import GuessList from '../components/GuessList.jsx';
import Confetti from '../components/Confetti.jsx';
import Icon from '../components/Icon.jsx';

/** Compte à rebours du tour : 15 s pour proposer. */
function TurnClock({ deadline, active }) {
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (!deadline) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [deadline]);

  if (!deadline) return null;
  const urgent = left <= 5;

  return (
    <span className={`turn-clock mono${urgent ? ' urgent' : ''}${active ? ' mine' : ''}`}>
      {left}s
    </span>
  );
}

function Chrono({ startedAt }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  return (
    <div className="chrono">
      <Icon name="clock" size={20} />
      {m}:{s}
    </div>
  );
}

/** Arène : écran splitté, tours alternés, chat et revanche. */
export default function Arena() {
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const inputRef = useRef(null);
  const chatRef = useRef(null);

  const [state, setState] = useState(null);
  const [secret, setSecret] = useState('');
  const [secretSent, setSecretSent] = useState(false);
  const [word, setWord] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [rematchVotes, setRematchVotes] = useState([]);
  const [bios, setBios] = useState(null);
  const [flash, setFlash] = useState('');

  const myId = user?.id;

  useEffect(() => {
    const socket = getSocket();
    if (!socket) {
      navigate('/duel');
      return;
    }

    socket.emit('resume');

    const onState = (s) => {
      setState(s);
      setBusy(false);
    };
    const onStart = (s) => {
      setState(s);
      setOver(null);
      setBusy(false);
    };
    const onGuess = () => setBusy(false);
    const onOver = (payload) => {
      setState(payload);
      setOver(payload);
      setBusy(false);
      refreshProfile();
    };
    const onError = ({ error: e }) => {
      setError(e);
      setBusy(false);
      setTimeout(() => setError(''), 4000);
    };
    const onChat = (m) => setMessages((prev) => [...prev, m]);
    const onVotes = ({ votes }) => setRematchVotes(votes);
    const onMatch = (s) => {
      setState(s);
      setOver(null);
      setSecret('');
      setSecretSent(false);
      setMessages([]);
      setRematchVotes([]);
      setBios(null);
    };
    const onNoRoom = () => navigate('/duel');
    const onDescriptions = (payload) => setBios(payload);
    const onTimeout = ({ playerId, missed }) => {
      setFlash(
        playerId === user?.id
          ? `Trop tard ! Tour perdu (${missed}/3)`
          : `Ton adversaire a laissé filer son tour (${missed}/3)`
      );
      setBusy(false);
      setTimeout(() => setFlash(''), 3000);
    };

    socket.on('state', onState);
    socket.on('game-start', onStart);
    socket.on('guess-result', onGuess);
    socket.on('game-over', onOver);
    socket.on('error-message', onError);
    socket.on('chat', onChat);
    socket.on('rematch-vote', onVotes);
    socket.on('match-found', onMatch);
    socket.on('no-room', onNoRoom);
    socket.on('descriptions', onDescriptions);
    socket.on('turn-timeout', onTimeout);
    socket.on('secret-accepted', () => setSecretSent(true));

    return () => {
      socket.off('state', onState);
      socket.off('game-start', onStart);
      socket.off('guess-result', onGuess);
      socket.off('game-over', onOver);
      socket.off('error-message', onError);
      socket.off('chat', onChat);
      socket.off('rematch-vote', onVotes);
      socket.off('match-found', onMatch);
      socket.off('no-room', onNoRoom);
      socket.off('descriptions', onDescriptions);
      socket.off('turn-timeout', onTimeout);
    };
  }, [navigate, refreshProfile]);

  useEffect(() => {
    chatRef.current?.scrollTo(0, chatRef.current.scrollHeight);
  }, [messages]);

  const me = useMemo(() => state?.players?.find((p) => p.userId === myId), [state, myId]);
  const foe = useMemo(() => state?.players?.find((p) => p.userId !== myId), [state, myId]);
  const myTurn = state?.turn === myId;

  useEffect(() => {
    if (myTurn && state?.status === 'playing') inputRef.current?.focus();
  }, [myTurn, state?.status]);

  const sendSecret = (e) => {
    e.preventDefault();
    if (!secret.trim()) return;
    getSocket()?.emit('set-secret', { word: secret.trim() });
  };

  const sendGuess = (e) => {
    e.preventDefault();
    if (!word.trim() || !myTurn || busy) return;
    setBusy(true);
    getSocket()?.emit('guess', { word: word.trim() });
    setWord('');
  };

  const sendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    getSocket()?.emit('chat', { message: chatInput.trim() });
    setChatInput('');
  };

  const surrender = () => {
    if (window.confirm('Abandonner la partie ?')) getSocket()?.emit('surrender');
  };

  const leave = () => {
    getSocket()?.emit('leave-room');
    navigate('/duel');
  };

  if (!state) {
    return (
      <div className="center" style={{ marginTop: 80 }}>
        <div className="spinner" />
        <p className="muted small" style={{ marginTop: 14 }}>
          Connexion à la partie<span className="dots" />
        </p>
      </div>
    );
  }

  /* ---------------------- Choix du mot secret ---------------------- */

  if (state.status === 'choosing') {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <div className="card">
          <h1 style={{ fontSize: 23, marginBottom: 6 }}>Choisis ton joueur secret</h1>
          <p className="muted small" style={{ marginBottom: 18 }}>
            C’est le joueur que <strong>{foe?.username || 'ton adversaire'}</strong> devra deviner. Choisis-le
            devinable — une star marche mieux qu’un inconnu.
          </p>

          {secretSent ? (
            <div className="stack-sm center">
              <div className="alert alert-info row" style={{ justifyContent: 'center' }}>
                <Icon name="check" size={16} /> Joueur enregistré
              </div>
              <div className="spinner" style={{ marginTop: 8 }} />
              <p className="muted small">
                En attente de {foe?.username || 'l’adversaire'}
                <span className="dots" />
              </p>
            </div>
          ) : (
            <form onSubmit={sendSecret} className="guess-form">
              <input
                className="input input-xl"
                type="password"
                placeholder="Ton joueur secret"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                maxLength={40}
                autoFocus
                autoComplete="off"
                aria-label="Joueur secret"
              />
              <button className="btn btn-lg" disabled={!secret.trim()}>
                Valider
              </button>
            </form>
          )}

          {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}

          <div className="row row-between small muted" style={{ marginTop: 16 }}>
            <span>
              {foe?.ready ? `${foe.username} est prêt` : `${foe?.username || 'Adversaire'} choisit…`}
            </span>
            <button className="btn-icon btn-text" onClick={leave}>
              Quitter
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* --------------------------- L'arène ---------------------------- */

  const isDraw = over?.reason === 'draw';
  const iWon = over && !isDraw && over.winnerId === myId;
  const timedOut = over?.reason === 'timeout';
  const myLast = me?.guesses?.at(-1);
  const foeLast = foe?.guesses?.at(-1);

  return (
    <div>
      {iWon && <Confetti />}

      <Chrono startedAt={state.startedAt} />

      {over ? (
        <div className="card center" style={{ marginBottom: 18 }}>
          <div className="result-icon">
            <Icon name={iWon ? 'trophy' : 'flag'} size={40} strokeWidth={1.5} />
          </div>
          <h2 style={{ fontSize: 24, margin: '10px 0 4px' }}>
            {isDraw ? 'Match nul' : iWon ? 'Victoire' : 'Défaite'}
          </h2>
          <p className="muted">
            {over.reason === 'disconnect' && 'Adversaire déconnecté. '}
            {over.reason === 'surrender' && 'Partie terminée par abandon. '}
            {isDraw && 'Vous avez tous les deux épuisé vos tentatives. '}
            {timedOut && 'Trois tours laissés filer : forfait. '}
            Les joueurs étaient :
          </p>
          <div className="row" style={{ justifyContent: 'center', gap: 18, marginTop: 10, flexWrap: 'wrap' }}>
            <span>
              <span className="muted small">le tien </span>
              <strong className="result-word" style={{ fontSize: 20 }}>
                {me?.secret}
              </strong>
            </span>
            <span>
              <span className="muted small">le sien </span>
              <strong className="result-word" style={{ fontSize: 20 }}>
                {foe?.secret}
              </strong>
            </span>
          </div>

          {over.summary?.[myId] && (
            <p className="pill pill-green" style={{ marginTop: 16 }}>
              +{over.summary[myId].points} points
            </p>
          )}

          {bios && (
            <div className="stack-sm" style={{ marginTop: 16 }}>
              {[me, foe].map(
                (p) =>
                  p &&
                  bios[p.userId] && (
                    <div key={p.userId} className="bio">
                      <span className="bio-label">{p.secret}</span>
                      {bios[p.userId]}
                    </div>
                  )
              )}
            </div>
          )}

          <div className="row wrap" style={{ marginTop: 20, gap: 10, justifyContent: 'center' }}>
            <button className="btn" onClick={() => getSocket()?.emit('rematch')}>
              <Icon name="repeat" /> Revanche {rematchVotes.length ? `(${rematchVotes.length}/2)` : ''}
            </button>
            <button className="btn btn-ghost" onClick={leave}>
              Retour au menu
            </button>
          </div>
        </div>
      ) : (
        <div className={`turn-banner${myTurn ? '' : ' waiting'}`}>
          {myTurn ? 'À toi de jouer' : `Au tour de ${foe?.username || 'l’adversaire'}`}
          <TurnClock deadline={state.turnDeadline} active={myTurn} />
        </div>
      )}

      <div className="arena">
        {/* ----- Mon côté ----- */}
        <section className={`arena-side${myTurn && !over ? ' is-turn' : ''}`}>
          <div className="arena-head">
            <div className="row">
              <span className="avatar">{(me?.username || '?')[0].toUpperCase()}</span>
              <div>
                <div style={{ fontWeight: 700 }}>Toi</div>
                <div className="small muted">
                  {me?.attempts || 0} essai(s) · {me?.remaining ?? 0} restant(s)
                </div>
              </div>
            </div>
            <span className="pill pill-blue mono">{me?.best ?? 0}</span>
          </div>

          <Gauge
            score={myLast?.score ?? null}
            label={myLast?.label}
            tier={myLast?.tier}
            pending={busy}
          />

          {!over && (
            <form className="guess-form" onSubmit={sendGuess} style={{ marginTop: 16 }}>
              <input
                ref={inputRef}
                className="input"
                placeholder={myTurn ? 'Un mot, un club, un joueur…' : 'Attends ton tour'}
                value={word}
                onChange={(e) => setWord(e.target.value)}
                disabled={!myTurn || busy}
                maxLength={40}
                autoComplete="off"
                aria-label="Ta proposition"
              />
              <button className="btn" disabled={!myTurn || busy || !word.trim()}>
                Valider
              </button>
            </form>
          )}

          <div style={{ marginTop: 14 }}>
            <GuessList guesses={me?.guesses || []} sort="best" emptyLabel="Aucune tentative." />
          </div>
        </section>

        {/* ----- Adversaire ----- */}
        <section className={`arena-side is-opponent${!myTurn && !over ? ' is-turn' : ''}`}>
          <div className="arena-head">
            <div className="row">
              <span className="avatar avatar-foe">{(foe?.username || '?')[0].toUpperCase()}</span>
              <div>
                <div style={{ fontWeight: 700 }}>{foe?.username || 'Adversaire'}</div>
                <div className="small muted">
                  {foe?.attempts || 0} tentative(s){foe?.connected === false && ' · déconnecté'}
                </div>
              </div>
            </div>
            <span className="pill mono">{foe?.best ?? 0}</span>
          </div>

          <Gauge
            score={foeLast?.score ?? null}
            label={foeLast?.label}
            tier={foeLast?.tier}
          />

          <div style={{ marginTop: 14 }}>
            <GuessList guesses={foe?.guesses || []} sort="best" emptyLabel="Aucune tentative." />
          </div>
        </section>
      </div>

      {flash && (
        <div className="alert alert-info" style={{ marginTop: 16 }}>
          {flash}
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}

      {/* ----- Chat + abandon ----- */}
      <div className="card card-tight chat" style={{ marginTop: 18 }}>
        <div className="row row-between" style={{ marginBottom: 8 }}>
          <h3 style={{ fontSize: 15 }}>Chat</h3>
          {!over && (
            <button className="btn btn-danger btn-sm" onClick={surrender}>
              Abandonner
            </button>
          )}
        </div>

        <div className="chat-log" ref={chatRef}>
          {messages.length === 0 ? (
            <p className="faint small">Dis bonjour à ton adversaire.</p>
          ) : (
            messages.map((m, i) => (
              <p key={i} className="chat-msg">
                <strong>{m.username}</strong> {m.message}
              </p>
            ))
          )}
        </div>

        <form className="guess-form" onSubmit={sendChat}>
          <input
            className="input"
            placeholder="Message…"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            maxLength={200}
            aria-label="Message de chat"
          />
          <button className="btn btn-ghost" disabled={!chatInput.trim()}>
            Envoyer
          </button>
        </form>
      </div>
    </div>
  );
}
