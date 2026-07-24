import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Gauge from '../components/Gauge.jsx';
import GuessList from '../components/GuessList.jsx';
import Confetti from '../components/Confetti.jsx';
import Icon from '../components/Icon.jsx';
import ShareResult from '../components/ShareResult.jsx';
import AdSlot from '../components/Ads.jsx';

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
}

function Countdown() {
  const [left, setLeft] = useState('');
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
      const diff = Math.max(0, next - now.getTime());
      const h = String(Math.floor(diff / 3_600_000)).padStart(2, '0');
      const m = String(Math.floor((diff % 3_600_000) / 60_000)).padStart(2, '0');
      const s = String(Math.floor((diff % 60_000) / 1000)).padStart(2, '0');
      setLeft(`${h}:${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="mono">{left}</span>;
}

export default function Solo() {
  const { refreshProfile } = useAuth();
  const inputRef = useRef(null);

  const [guesses, setGuesses] = useState([]);
  const [last, setLast] = useState(null);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);
  const [unlocked, setUnlocked] = useState([]);
  const [surrendered, setSurrendered] = useState(false);
  const [sort, setSort] = useState('best');
  const [description, setDescription] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['daily-word'],
    queryFn: async () => (await api.get('/daily-word')).data,
  });

  useEffect(() => {
    if (!data) return;
    setGuesses(data.guesses || []);
    if (data.result) {
      setResult(data.result);
      setSurrendered(Boolean(data.result.surrendered));
      setDescription(data.description || null);
    }
    const best = [...(data.guesses || [])].sort((a, b) => b.score - a.score)[0];
    if (best) setLast(best);
  }, [data]);

  useEffect(() => {
    if (!result) inputRef.current?.focus();
  }, [result, guesses.length]);

  const bestScore = useMemo(() => guesses.reduce((m, g) => Math.max(m, g.score), 0), [guesses]);

  const submit = async (e) => {
    e.preventDefault();
    const value = word.trim();
    if (!value || busy || result) return;

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data: res } = await api.post('/guess', { word: value });

      if (res.duplicate) {
        setNotice(res.message);
        setLast({ ...res, tier: res.tier });
        setWord('');
        return;
      }

      setLast(res);
      setGuesses((prev) => [...prev, { word: res.word, score: res.score, tier: res.tier, attempt: res.attempt }]);
      setWord('');

      if (res.found || res.exhausted) {
        setResult(res.result);
        setDescription(res.description || null);
        setUnlocked(res.unlocked || []);
        refreshProfile();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const surrender = async () => {
    if (!window.confirm('Abandonner et révéler le joueur mystère ?')) return;
    try {
      const { data: res } = await api.post('/surrender');
      setSurrendered(true);
      setDescription(res.description || null);
      setResult({ ...res, score: 0, seconds: 0, attempts: res.attempts });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (isLoading) return <div className="spinner" style={{ marginTop: 80 }} />;

  const puzzle = data?.puzzle;
  const finished = Boolean(result);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      {finished && !surrendered && <Confetti />}

      <div className="row row-between wrap" style={{ marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 26 }}>Joueur mystère n°{puzzle?.number}</h1>
          <p className="muted small">
            Envoie des mots-clés : club, pays, poste, trophée, coéquipier… ou un nom de joueur.
          </p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="pill">
            <Icon name="clock" size={14} /> Nouveau joueur dans <Countdown />
          </span>
          {data?.engine === 'fallback' && (
            <span className="pill" title="Ajoute ANTHROPIC_API_KEY dans server/.env">
              <Icon name="alert" size={14} /> mode secours
            </span>
          )}
        </div>
      </div>

      {finished ? (
        <div className="card">
          <div className="result-hero">
            <div className="result-icon">
              <Icon name={result.outcome === 'found' ? 'trophy' : 'flag'} size={44} strokeWidth={1.5} />
            </div>
            <h2 style={{ fontSize: 24, margin: '10px 0 6px' }}>
              {result.outcome === 'exhausted'
                ? 'Tentatives épuisées'
                : result.outcome === 'surrendered'
                  ? 'Partie abandonnée'
                  : `Trouvé en ${result.attempts} tentative${result.attempts > 1 ? 's' : ''}`}
            </h2>
            <p className="muted">Le joueur mystère était</p>
            <p className="result-word">{result.word}</p>

            {description && (
              <div className="bio">
                <span className="bio-label">Qui est-ce ?</span>
                {description}
              </div>
            )}
          </div>

          <div className="stat-grid" style={{ marginTop: 18 }}>
            <div className="stat">
              <div className="stat-value">{result.attempts}</div>
              <div className="stat-label">Tentatives</div>
            </div>
            <div className="stat">
              <div className="stat-value">{formatDuration(result.seconds || 0)}</div>
              <div className="stat-label">Temps</div>
            </div>
            <div className="stat">
              <div className="stat-value tier-blazing">{result.score}</div>
              <div className="stat-label">Points</div>
            </div>
          </div>

          {unlocked.length > 0 && (
            <div className="stack-sm" style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 16 }}>Médailles débloquées</h3>
              <div className="badge-grid">
                {unlocked.map((a) => (
                  <div key={a.code} className="badge earned">
                    <span className="badge-icon">
                      <Icon name="medal" size={20} />
                    </span>
                    <div>
                      <div className="badge-name">{a.name}</div>
                      <div className="badge-desc">{a.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <ShareResult
            puzzleNumber={puzzle?.number}
            attempts={result.attempts}
            score={result.score}
            guesses={guesses}
            outcome={result.outcome || (surrendered ? 'surrendered' : 'found')}
            maxAttempts={data?.maxAttempts || 50}
          />

          <AdSlot slot="1234567890" />

          <div className="row wrap" style={{ marginTop: 20, gap: 10 }}>
            <Link to="/duel" className="btn btn-ghost grow">
              <Icon name="swords" /> Jouer en duel
            </Link>
            <Link to="/classement" className="btn btn-ghost grow">
              Voir le classement
            </Link>
          </div>

          <div style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 15, marginBottom: 8 }}>Tes {guesses.length} tentatives</h3>
            <GuessList guesses={guesses} sort="best" />
          </div>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <Gauge
              score={last?.score ?? null}
              label={last?.label}
              tier={last?.tier}
                    pending={busy}
            />

            <form className="guess-form" onSubmit={submit} style={{ marginTop: 18 }}>
              <input
                ref={inputRef}
                className="input input-xl"
                placeholder="Un mot, un club, un joueur…"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                maxLength={40}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck="false"
                aria-label="Ton joueur"
                disabled={busy}
              />
              <button className="btn btn-lg" disabled={busy || !word.trim()}>
                {busy ? '…' : 'Valider'}
              </button>
            </form>

            {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
            {notice && <div className="alert alert-info" style={{ marginTop: 12 }}>{notice}</div>}

            <div className="row row-between small muted" style={{ marginTop: 14 }}>
              <span>
                <strong className="mono">{Math.max(0, (data?.maxAttempts || 50) - guesses.length)}</strong>{' '}
                tentative(s) restante(s) · meilleur score <strong className="mono">{bestScore}</strong>
              </span>
              <button className="btn-icon btn-text" onClick={surrender}>
                Renoncer
              </button>
            </div>
          </div>

          <div className="card">
            <div className="row row-between" style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 16 }}>Historique</h3>
              <div className="tabs" style={{ width: 200, marginBottom: 0 }}>
                <button className={`tab${sort === 'best' ? ' active' : ''}`} onClick={() => setSort('best')}>
                  Meilleurs
                </button>
                <button className={`tab${sort === 'recent' ? ' active' : ''}`} onClick={() => setSort('recent')}>
                  Récents
                </button>
              </div>
            </div>
            <GuessList guesses={guesses} sort={sort} emptyLabel="Lance-toi : envoie un mot-clé, même vague." />
          </div>
        </>
      )}
    </div>
  );
}
