import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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
  /*
   * L'essai gratuit, tel que le serveur le voit.
   *
   * Rafraîchi à chaque proposition plutôt que décrémenté ici : c'est le
   * serveur qui décide ce qu'une proposition consomme — une évaluation en
   * panne ne coûte rien — et un compteur tenu des deux côtés finit toujours
   * par afficher un chiffre que le refus contredira.
   */
  const [trial, setTrial] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['daily-word'],
    queryFn: async () => (await api.get('/daily-word')).data,
  });

  useEffect(() => {
    if (!data) return;
    setGuesses(data.guesses || []);
    publierCredits(data.credits);
    setTrial(data.trial || null);
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
      if (res.trial) setTrial(res.trial);
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

  /*
   * L'essai vient de se terminer sur une partie encore ouverte.
   *
   * C'est le moment de vente du jeu, et il n'a lieu qu'ici : le joueur a vu
   * la jauge répondre huit fois, il a un meilleur score sous les yeux, et le
   * nom qu'il cherche est à quelques mots. Lui dire « reviens demain »
   * serait perdre exactement la personne qu'on vient de convaincre.
   *
   * `!finished` compte : si la huitième chance était la bonne, on lui doit
   * d'abord sa victoire. L'offre attend la fin de la fête.
   */
  const essaiEpuise = Boolean(trial?.exhausted) && !finished;
  // Ce que l'abonnement rouvre TOUT DE SUITE, sur cette partie-ci : les
  // chances déjà jouées comptent dans les vingt, elles ne s'ajoutent pas.
  const chancesRendues = Math.max(0, maxAttempts - guesses.length);

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
          {!finished &&
            (trial?.active ? (
              /* Pendant l'essai, la promesse « comprise dans l'abonnement »
                 ne veut rien dire — il n'y a pas d'abonnement. Ce qui compte
                 est le compte à rebours, et il doit être lisible d'un coup
                 d'œil : un essai qu'on ne voit pas fondre ne fait rien
                 décider. */
              <span className="pill" title="Essai gratuit, sans carte bancaire">
                <Icon name="gift" size={13} /> Essai — {trial.remaining}/{trial.total} chance
                {trial.remaining > 1 ? 's' : ''}
              </span>
            ) : (
              <span className="pill pill-green" title="Comprise dans ton abonnement">
                <Icon name="check" size={13} /> Partie du jour incluse
              </span>
            ))}
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
          {/*
            Le mur, à la place exacte du champ de saisie.
            Pas une fenêtre modale : on ne peut pas la refuser, parce qu'il
            n'y a rien derrière — la partie ne peut plus avancer. Une croix
            dans un coin promettrait un jeu qui n'existe plus.
            L'historique reste affiché juste en dessous, volontairement : le
            meilleur argument de vente est ce que le joueur a déjà fait.
          */}
          {essaiEpuise && (
            <div className="card center" style={{ marginBottom: 16 }}>
              <span className="premium-modal-icon">
                <Icon name="crown" size={26} />
              </span>
              <h2 style={{ fontSize: 22, margin: '14px 0 6px' }}>
                Tes {trial?.total} chances d'essai sont passées
              </h2>
              <p className="muted small" style={{ margin: '0 auto 18px', maxWidth: 440 }}>
                Le joueur mystère n'est pas encore tombé — et ta partie reste exactement où tu
                l'as laissée. En t'abonnant, tu la reprends ici même avec{' '}
                <strong>{chancesRendues} chances</strong> pour finir, et le joueur du jour
                t'attend tous les matins.
              </p>

              <div className="row" style={{ gap: 8, justifyContent: 'center', marginBottom: 18 }}>
                <span className="pill">
                  <Icon name="target" size={13} /> meilleur score{' '}
                  <strong className="mono">{bestScore}</strong>
                </span>
                <span className="pill">
                  <Icon name="flame" size={13} /> {guesses.length} proposition
                  {guesses.length > 1 ? 's' : ''}
                </span>
              </div>

              <Link to="/premium?essai=epuise" className="btn btn-block btn-lg">
                Continuer — à partir de 2,99 €/mois
              </Link>
              <p className="small faint" style={{ margin: '12px 0 0' }}>
                Chaque proposition est évaluée par une IA, et chaque évaluation se paie. C'est
                tout ce que finance l'abonnement.
              </p>
            </div>
          )}

          {!essaiEpuise && (
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
              {/* Pendant l'essai, c'est LUI qui borne la partie, pas les
                  vingt chances du jeu. Afficher « 17 restantes » à quelqu'un
                  qui sera arrêté à la troisième serait un mensonge, et il
                  s'en apercevrait au pire moment. */}
              <span>
                <strong className="mono">
                  {trial?.active ? trial.remaining : Math.max(0, maxAttempts - guesses.length)}
                </strong>{' '}
                chance(s) restante(s){trial?.active ? ' sur ton essai' : ''} · meilleur score{' '}
                <strong className="mono">{bestScore}</strong>
              </span>
              <button className="btn-icon btn-text" onClick={surrender}>
                Renoncer
              </button>
            </div>
          </div>
          )}

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
