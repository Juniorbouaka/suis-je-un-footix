import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../lib/socket.js';
import { useAuth } from '../lib/auth.jsx';
import Gauge from '../components/Gauge.jsx';
import GuessList from '../components/GuessList.jsx';
import Confetti from '../components/Confetti.jsx';
import Icon from '../components/Icon.jsx';
import PremiumBadge from '../components/PremiumBadge.jsx';

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
  const [word, setWord] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [rematchVotes, setRematchVotes] = useState([]);
  const [bio, setBio] = useState(null);
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
      setMessages([]);
      setRematchVotes([]);
      setBio(null);
    };
    const onNoRoom = () => navigate('/duel');
    const onDescriptions = (payload) => setBio(payload);
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

  /* --------------------------- L'arène ---------------------------- */

  const isDraw = over?.reason === 'draw';
  const iWon = over && !isDraw && over.winnerId === myId;
  const timedOut = over?.reason === 'timeout';
  const myLast = me?.guesses?.at(-1);
  const foeLast = foe?.guesses?.at(-1);

  return (
    <div>
      {iWon && <Confetti />}

      <div className="center" style={{ marginBottom: 12 }}>
        <span className="pill pill-blue">Même joueur mystère pour vous deux</span>
      </div>

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
            Le joueur mystère était
          </p>
          <p className="result-word">{over.secret}</p>

          {over.summary?.[myId] && (
            <p className="pill pill-green" style={{ marginTop: 16 }}>
              +{over.summary[myId].points} points
            </p>
          )}

          {bio && (
            <div className="bio" style={{ marginTop: 16 }}>
              <span className="bio-label">Qui est-ce ?</span>
              {bio.text}
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
                placeholder={myTurn ? 'Un mot, un club, un joueur…' : 'Observe et prépare ton coup'}
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
                <div className="row" style={{ fontWeight: 700, gap: 6 }}>
                  {foe?.username || 'Adversaire'}
                  {foe?.isPremium && <PremiumBadge size={12} />}
                </div>
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
                <strong>{m.username}</strong>
                {m.isPremium && <PremiumBadge size={11} />} {m.message}
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
