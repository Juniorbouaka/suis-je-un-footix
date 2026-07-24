import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { usePresence, useMidnightCountdown } from '../lib/presence.js';
import AuthModal from '../components/AuthModal.jsx';
import Gauge from '../components/Gauge.jsx';
import GuessList from '../components/GuessList.jsx';
import Icon from '../components/Icon.jsx';
import AdSlot from '../components/Ads.jsx';

/** Manche de démonstration, sans compte. */
function Tutorial() {
  const [word, setWord] = useState('');
  const [result, setResult] = useState(null);
  const [guesses, setGuesses] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const value = word.trim();
    if (!value || busy) return;

    const already = guesses.find((g) => g.word.toLowerCase() === value.toLowerCase());
    if (already) {
      setNotice('Tu as déjà proposé ce mot.');
      setResult(already);
      setWord('');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post('/demo/guess', { word: value });
      setResult(data);
      setGuesses((prev) => [
        ...prev,
        { word: data.word, score: data.score, tier: data.tier, label: data.label, attempt: prev.length + 1 },
      ]);
      setWord('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-float">
      <div className="row row-between wrap" style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 19 }}>Échauffement</h2>
        <span className="pill">Démo · sans compte</span>
      </div>
      <p className="muted small" style={{ marginBottom: 16 }}>
        Un footballeur est caché. Envoie n’importe quel mot — club, pays, poste, trophée, nom de joueur :
        plus le <strong>lien</strong> avec lui est fort, plus la jauge monte.
      </p>

      <Gauge
        score={result?.score ?? null}
        label={result?.label}
        tier={result?.tier}
        pending={busy}
      />

      <form className="guess-form" onSubmit={submit} style={{ marginTop: 16 }}>
        <input
          className="input"
          placeholder="ex. gardien, italie, ballon d’or, pirlo…"
          value={word}
          onChange={(e) => setWord(e.target.value)}
          maxLength={40}
          aria-label="Mot-clé"
        />
        <button className="btn" disabled={busy || !word.trim()}>
          Tester
        </button>
      </form>

      {error && <div className="alert alert-error" style={{ marginTop: 10 }}>{error}</div>}
      {notice && <div className="alert alert-info" style={{ marginTop: 10 }}>{notice}</div>}

      {result?.found && (
        <>
          <div className="alert alert-info" style={{ marginTop: 12 }}>
            Trouvé en {guesses.length} tentative{guesses.length > 1 ? 's' : ''}. Crée un compte pour jouer
            le joueur du jour.
          </div>
          {result.description && (
            <div className="bio">
              <span className="bio-label">La fiche</span>
              {result.description}
            </div>
          )}
        </>
      )}

      {guesses.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="row row-between" style={{ marginBottom: 8 }}>
            <h3 style={{ fontSize: 15 }}>Tes propositions</h3>
            <span className="small muted">
              {guesses.length} tentative{guesses.length > 1 ? 's' : ''}
            </span>
          </div>
          <GuessList guesses={guesses} sort="best" />
        </div>
      )}
    </div>
  );
}

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [authOpen, setAuthOpen] = useState(false);
  const [intent, setIntent] = useState('/solo');
  const online = usePresence();
  const countdown = useMidnightCountdown();

  const { data: stats } = useQuery({
    queryKey: ['global-stats'],
    queryFn: async () => (await api.get('/stats/global')).data,
    refetchInterval: 15_000,
  });

  const liveCount = online ?? stats?.online ?? 0;

  const go = (path) => {
    setIntent(path);
    if (isAuthenticated) navigate(path);
    else setAuthOpen(true);
  };

  return (
    <>
      <section className="hero">
        <span className="hero-kicker">
          <span className="live-dot" />
          {liveCount} joueur{liveCount > 1 ? 's' : ''} en ligne maintenant
        </span>

        <h1>Suis-je un footix ?</h1>
        <p>
          Un footballeur mystère chaque jour, sans le moindre indice. Envoie des mots-clés — un club,
          un pays, un poste, un trophée, un coéquipier — l’IA note la force du lien. À toi de resserrer
          jusqu’à trouver son nom.
        </p>
        <div className="hero-actions">
          <button className="btn btn-lg" onClick={() => go('/solo')}>
            <Icon name="target" size={19} /> Jouer seul
          </button>
          <button className="btn btn-lg btn-ghost" onClick={() => go('/duel')}>
            <Icon name="swords" size={19} /> Défier quelqu’un
          </button>
        </div>

        <div className="countdown-card">
          <div>
            <div className="small muted" style={{ fontWeight: 650 }}>
              Prochain joueur mystère dans
            </div>
            <div className="countdown-clock mono">
              {countdown.h}:{countdown.m}:{countdown.s}
            </div>
          </div>
          <span className="live">
            <span className="live-dot" />
            {liveCount} en ligne
          </span>
        </div>

        <div className="stat-grid">
          <div className="stat">
            <div className="stat-value">n°{stats?.puzzleNumber ?? '—'}</div>
            <div className="stat-label">Joueur du jour</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats?.players ?? '—'}</div>
            <div className="stat-label">Inscrits</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats?.solvedToday ?? '—'}</div>
            <div className="stat-label">Trouvé aujourd’hui</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats?.guessesToday ?? '—'}</div>
            <div className="stat-label">Tentatives du jour</div>
          </div>
        </div>
      </section>

      <Tutorial />

      <AdSlot slot="0987654321" />

      <div className="feature-grid">
        <div className="feature">
          <div className="feature-icon">⚡</div>
          <h3>Addictif</h3>
          <p>Une partie dure 5 à 15 minutes. Parfait pour une pause.</p>
        </div>
        <div className="feature">
          <div className="feature-icon">📚</div>
          <h3>Culture foot</h3>
          <p>Des stars planétaires aux joueurs que seuls les vrais connaissent.</p>
        </div>
        <div className="feature">
          <div className="feature-icon">🤝</div>
          <h3>Social</h3>
          <p>Défie un ami en temps réel et grimpe au classement.</p>
        </div>
        <div className="feature">
          <div className="feature-icon">🧠</div>
          <h3>Malin</h3>
          <p>L’IA compare les joueurs par le sens, pas par l’orthographe.</p>
        </div>
      </div>

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSuccess={() => {
          setAuthOpen(false);
          navigate(intent);
        }}
      />
    </>
  );
}
