import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { publierCredits, useCredits } from '../lib/credits.js';
import Gauge from '../components/Gauge.jsx';
import GuessList from '../components/GuessList.jsx';
import Confetti from '../components/Confetti.jsx';
import Icon from '../components/Icon.jsx';
import ResultCard from '../components/ResultCard.jsx';
import ReplayModal from '../components/ReplayModal.jsx';

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
  const { refreshProfile, stats, isPremium, credits: duProfil } = useAuth();
  const inputRef = useRef(null);
  // Le portefeuille commun : l'en-tête et cette page doivent afficher le
  // même chiffre au même instant.
  const credits = useCredits(duProfil);

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
    publierCredits(data.credits);
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
      // Le débit a lieu à la première proposition : le solde renvoyé avec
      // elle est le seul qui fasse foi.
      publierCredits(res.credits);

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
      publierCredits(res.credits);
      setResult({ ...res, score: 0, seconds: 0, attempts: res.attempts });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (isLoading) return <div className="spinner" style={{ marginTop: 80 }} />;

  const puzzle = data?.puzzle;
  const finished = Boolean(result);
  const maxAttempts = data?.maxAttempts ?? 20;
  // `surrendered` vient de la partie rechargée, `outcome` de la partie qui
  // vient de se terminer : les deux disent la même chose, jamais en même temps.
  const issue = result?.outcome || (surrendered ? 'surrendered' : 'found');

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      {finished && !surrendered && <Confetti />}

      {/* « Plus de parties » — au bout de la partie, jamais avant, une seule
          fois par jour, et seulement si le stock est vraiment épuisé. Le
          composant gère lui-même sa politesse. */}
      {finished && <ReplayModal outcome={issue} isPremium={isPremium} credits={credits} />}

      <div className="row row-between wrap" style={{ marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 26 }}>Joueur mystère n°{puzzle?.number}</h1>
          <p className="muted small">
            Envoie des mots-clés : club, pays, poste, trophée, coéquipier… ou un nom de joueur.
          </p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {/* Le rendez-vous du jour ne décompte rien, et on le dit : c'est la
              promesse principale de l'abonnement, elle doit être visible là
              où elle se vérifie. */}
          {!finished && (
            <span className="pill pill-green" title="Comprise dans ton abonnement">
              <Icon name="check" size={13} /> Partie du jour incluse
            </span>
          )}
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
        <ResultCard
          result={{ ...result, outcome: issue }}
          description={description}
          guesses={guesses}
          unlocked={unlocked}
          puzzleNumber={puzzle?.number}
          maxAttempts={maxAttempts}
          isPremium={isPremium}
          credits={credits}
          serie={stats?.currentStreak ?? 0}
        />
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
                <strong className="mono">{Math.max(0, maxAttempts - guesses.length)}</strong>{' '}
                chance(s) restante(s) · meilleur score <strong className="mono">{bestScore}</strong>
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
