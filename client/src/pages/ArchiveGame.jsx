import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, creditsDeLErreur, errorMessage, sansCredit } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { publierCredits, useCredits } from '../lib/credits.js';
import Gauge from '../components/Gauge.jsx';
import GuessList from '../components/GuessList.jsx';
import Icon from '../components/Icon.jsx';

/**
 * Rejouer une journée passée.
 *
 * Même déroulé qu'en solo, même prix — une partie du stock — mais rien n'est
 * compté : ni points, ni médailles, ni classement. C'est du contenu, pas une
 * source de score : un abonnement ne doit jamais pouvoir acheter une place au
 * classement.
 *
 * Le débit tombe à la première proposition, une seule fois pour la journée.
 * Recharger la page, revenir demain, reprendre une partie interrompue : rien
 * de tout cela ne repaie. Seul « Recommencer » débite de nouveau, et c'est
 * annoncé avant le clic — sinon effacer ses essais offrirait une partie.
 */

function formatDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function ArchiveGame() {
  const { date } = useParams();
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const { isPremium, credits: duProfil } = useAuth();
  const credits = useCredits(duProfil);

  const [guesses, setGuesses] = useState([]);
  const [last, setLast] = useState(null);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);
  const [reveal, setReveal] = useState(null); // { word, description }
  const [sort, setSort] = useState('best');

  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: ['archive-day', date],
    queryFn: async () => (await api.get(`/archive/${date}`)).data,
    retry: false,
  });

  useEffect(() => {
    if (!data) return;
    setGuesses(data.guesses || []);
    publierCredits(data.credits);
    if (data.result) setResult(data.result);
    if (data.word) setReveal({ word: data.word, description: data.description });
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
      const { data: res } = await api.post(`/archive/${date}/guess`, { word: value });

      if (res.duplicate) {
        setNotice(res.message);
        setLast({ ...res, tier: res.tier });
        setWord('');
        return;
      }

      setLast(res);
      setGuesses((prev) => [
        ...prev,
        { word: res.word, score: res.score, tier: res.tier, attempt: res.attempt },
      ]);
      setWord('');
      // Le débit tombe à la première proposition : c'est là que le serveur
      // renvoie le solde à jour, et nulle part ailleurs.
      publierCredits(res.credits);

      if (res.result) {
        setResult(res.result);
        setReveal({ word: res.result.word, description: res.description });
      }
    } catch (err) {
      if (sansCredit(err)) publierCredits(creditsDeLErreur(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const surrender = async () => {
    if (!window.confirm('Abandonner et révéler le joueur de cette journée ?')) return;
    try {
      const { data: res } = await api.post(`/archive/${date}/surrender`);
      setResult(res.result);
      setReveal({ word: res.word, description: res.description });
      publierCredits(res.credits);
    } catch (err) {
      if (sansCredit(err)) publierCredits(creditsDeLErreur(err));
      setError(errorMessage(err));
    }
  };

  /*
   * Recommencer débite une partie, et il faut le dire avant le clic.
   *
   * Le serveur ne peut pas l'offrir : une journée déjà payée le reste, donc
   * effacer puis rejouer rendrait la journée gratuite indéfiniment. Le prix
   * est donc réel, et une confirmation qui n'en parlerait pas ferait
   * disparaître une partie du stock sans prévenir.
   */
  const recommencer = async () => {
    const entamee = guesses.length > 0 || Boolean(result);
    const question = entamee
      ? 'Effacer cette partie et recommencer la journée à zéro ? Une partie de ton stock sera débitée.'
      : 'Recommencer cette journée à zéro ?';
    if (!window.confirm(question)) return;

    try {
      const { data: res } = await api.delete(`/archive/${date}/replay`);
      publierCredits(res?.credits);
      setGuesses([]);
      setResult(null);
      setReveal(null);
      setLast(null);
      setError('');
    } catch (err) {
      if (sansCredit(err)) publierCredits(creditsDeLErreur(err));
      setError(errorMessage(err));
    }
  };

  if (isLoading) return <div className="spinner" style={{ marginTop: 80 }} />;

  if (isError) {
    return (
      <div className="card center" style={{ maxWidth: 480, margin: '60px auto' }}>
        <Icon name="lock" size={32} />
        <p className="muted" style={{ marginTop: 12 }}>{errorMessage(loadError)}</p>
        <div className="row" style={{ gap: 10, marginTop: 16, justifyContent: 'center' }}>
          <button className="btn btn-ghost" onClick={() => navigate('/archives')}>
            Retour aux archives
          </button>
          <Link to="/premium" className="btn">
            Voir le premium
          </Link>
        </div>
      </div>
    );
  }

  const finished = Boolean(result);
  const maxAttempts = data?.maxAttempts ?? 20;
  /*
   * Cette journée est-elle déjà payée ?
   *
   * `paid` vient du serveur. Une journée payée se termine quoi qu'il arrive,
   * même si le stock s'est vidé entre-temps : elle est due, on l'a réglée.
   */
  const payee = Boolean(data?.paid);
  const solde = credits?.balance ?? 0;
  // Le mur ne se dresse qu'avant la première proposition d'une journée non
  // payée. Le champ disparaît plutôt que de rester ouvert sur un refus.
  const sansStock = !payee && !finished && solde <= 0;
  const fige = busy || data?.playedForReal || sansStock;
  const recharge = credits?.nextRecharge
    ? new Date(credits.nextRecharge).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
    : null;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="row row-between wrap" style={{ marginBottom: 18 }}>
        <div>
          <Link to="/archives" className="small muted">
            ← Archives
          </Link>
          <h1 style={{ fontSize: 26, marginTop: 4 }}>Journée n°{data?.number}</h1>
          <p className="muted small">{formatDate(date)}</p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {/* Une journée déjà payée ne coûte plus rien : le compteur ne doit
              pas laisser croire qu'elle va être débitée une seconde fois. */}
          {!finished &&
            (payee ? (
              <span className="pill pill-green" title="Le débit a déjà eu lieu">
                <Icon name="check" size={13} /> Journée payée
              </span>
            ) : (
              <span className="pill">
                <Icon name="target" size={13} /> 1 partie de ton stock
              </span>
            ))}
          <span className="pill" title="Le rejeu ne rapporte aucun point">
            <Icon name="repeat" size={14} /> Rejeu — hors classement
          </span>
        </div>
      </div>

      {sansStock && (
        <div className="card center" style={{ marginBottom: 16 }}>
          <span className="premium-hero-icon">
            <Icon name="clock" size={30} strokeWidth={1.6} />
          </span>
          <h2 style={{ fontSize: 20, margin: '12px 0 8px' }}>Plus de parties en réserve</h2>
          <p className="muted small" style={{ maxWidth: 440, margin: '0 auto' }}>
            Cette journée t'attendra — elle ne disparaît pas, et le joueur du jour reste compris
            dans ton abonnement.
            {recharge ? ` Ta réserve se recharge le ${recharge}.` : ''}
          </p>
          <div className="row wrap" style={{ gap: 10, marginTop: 18, justifyContent: 'center' }}>
            <Link to="/premium#recharges" className="btn">
              <Icon name="target" size={15} /> Prendre des parties
            </Link>
            <Link to="/solo" className="btn btn-ghost">
              Jouer la partie du jour
            </Link>
          </div>
        </div>
      )}

      {data?.playedForReal && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          Tu avais déjà joué cette journée le jour même : elle n'est pas rejouable.
        </div>
      )}

      {finished ? (
        <div className="card">
          <div className="result-hero">
            <div className="result-icon">
              <Icon name={result.outcome === 'found' ? 'trophy' : 'flag'} size={44} strokeWidth={1.5} />
            </div>
            <h2 style={{ fontSize: 23, margin: '10px 0 6px' }}>
              {result.outcome === 'found'
                ? `Trouvé en ${result.attempts} tentative${result.attempts > 1 ? 's' : ''}`
                : result.outcome === 'exhausted'
                  ? 'Tentatives épuisées'
                  : 'Partie abandonnée'}
            </h2>
            <p className="muted">Le joueur de cette journée était</p>
            <p className="result-word">{reveal?.word}</p>

            {reveal?.description && (
              <div className="bio">
                <span className="bio-label">Qui est-ce ?</span>
                {reveal.description}
              </div>
            )}
          </div>

          <div className="row wrap" style={{ marginTop: 20, gap: 10 }}>
            <button className="btn btn-ghost grow" onClick={recommencer}>
              <Icon name="repeat" /> Recommencer
            </button>
            <Link to="/archives" className="btn grow">
              Une autre journée
            </Link>
          </div>

          {guesses.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 15, marginBottom: 8 }}>Tes {guesses.length} tentatives</h3>
              <GuessList guesses={guesses} sort="best" />
            </div>
          )}
        </div>
      ) : sansStock ? null : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <Gauge score={last?.score ?? null} label={last?.label} tier={last?.tier} pending={busy} />

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
                disabled={fige}
              />
              <button className="btn btn-lg" disabled={fige || !word.trim()}>
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
              <button className="btn-icon btn-text" onClick={surrender} disabled={sansStock}>
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
                <button
                  className={`tab${sort === 'recent' ? ' active' : ''}`}
                  onClick={() => setSort('recent')}
                >
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
