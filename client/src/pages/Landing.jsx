import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { usePresence, useMidnightCountdown } from '../lib/presence.js';
import AuthModal from '../components/AuthModal.jsx';
import Icon from '../components/Icon.jsx';
import AdSlot from '../components/Ads.jsx';
import SupportSection from '../components/SupportSection.jsx';

export default function Landing() {
  const { isAuthenticated, hasAccess, canPlay, canDuel, trial, duelTrial } = useAuth();
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

  /*
   * Un clic sur « Jouer » mène à l'endroit exact où l'on en est : la partie
   * pour un abonné, l'essai pour qui ne l'a pas encore brûlé, l'offre pour
   * les autres, la création de compte pour un visiteur.
   *
   * Envoyer tout le monde vers /solo pour laisser le mur rebondir marcherait
   * aussi, mais ferait clignoter un écran de jeu avant la redirection —
   * l'impression d'une porte qu'on ouvre puis qu'on referme au nez.
   *
   * Le droit consulté n'est pas le même selon la destination, et les deux
   * boutons ont chacun le leur : `canPlay` pour le mot du jour, `canDuel`
   * pour le duel. Les deux essais s'épuisent séparément — huit chances d'un
   * côté, un duel entier de l'autre — donc les deux boutons peuvent très
   * bien ne pas mener au même endroit, et c'est exactement ce qu'on veut :
   * celui qui a brûlé ses chances se voit encore offrir un duel.
   *
   * Le motif du renvoi suit le bouton cliqué, pour que la page d'offre
   * parle de ce qui vient de se refermer et pas d'autre chose.
   */
  const go = (path) => {
    setIntent(path);
    if (!isAuthenticated) return setAuthOpen(true);
    const solo = path === '/solo';
    if (solo ? canPlay : canDuel) return navigate(path);
    const epuise = solo ? trial?.exhausted : duelTrial?.exhausted;
    if (hasAccess || !epuise) return navigate('/premium?requis=1');
    navigate(solo ? '/premium?essai=epuise' : '/premium?duel=epuise');
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

        {/*
          L'essai d'abord, le prix ensuite — et les deux sur la première page.
          Chaque proposition est un appel d'IA facturé : le jeu ne peut pas
          être gratuit, et le laisser croire pour l'annoncer trois écrans plus
          loin serait la façon la plus sûre de perdre quelqu'un. Mais annoncer
          le prix SEUL était l'autre façon de le perdre : on demandait de
          payer pour une chose qu'il n'avait jamais vue tourner. L'essai
          répond à ça, et il est ce qu'on met en avant — le prix vient après,
          en toutes lettres, une fois qu'on a dit ce qu'on donne.
        */}
        {!hasAccess &&
          (trial?.exhausted ? (
            /* L'essai est passé : lui promettre des chances offertes serait
               un mensonge qu'il découvrirait au clic suivant. On lui parle
               de ce qui reste vrai — sa partie du jour, et le prix. */
            <p className="small muted" style={{ marginTop: 14 }}>
              <Icon name="crown" size={13} />{' '}
              {/* Ses huit chances sont passées, mais son duel offert peut
                  très bien être encore là : les deux essais ne s'épuisent
                  pas ensemble, et lui annoncer une fin de partie générale
                  serait fermer une porte qui est ouverte. */}
              {duelTrial?.remaining > 0 ? (
                <>
                  <strong>Tes chances d'essai sont passées</strong> — il te reste un duel offert,
                  et ta partie du jour reste ouverte. L'abonnement démarre à 2,99 € par mois et te
                  la rend là où tu l'as laissée.{' '}
                  <Link to="/premium?essai=epuise">Voir les formules</Link>.
                </>
              ) : (
                <>
                  <strong>Ton essai est terminé</strong> — ta partie du jour, elle, reste ouverte.
                  L'abonnement démarre à 2,99 € par mois et te la rend là où tu l'as laissée.{' '}
                  <Link to="/premium?essai=epuise">Voir les formules</Link>.
                </>
              )}
            </p>
          ) : (
            <p className="small muted" style={{ marginTop: 14 }}>
              <Icon name="gift" size={13} />{' '}
              <strong>
                {trial?.used > 0
                  ? `Il te reste ${trial.remaining} chance${trial.remaining > 1 ? 's' : ''} d'essai`
                  : `${trial?.total ?? stats?.trialGuesses ?? 8} chances offertes pour essayer`}
                {/*
                  Le duel offert s'annonce à côté des chances, jamais à la
                  place : ce sont deux essais distincts, et c'est le duel qui
                  donne envie — on ne s'abonne pas pour jouer seul. On cesse
                  d'en parler dès qu'il est joué, sinon la promesse serait
                  démentie au clic suivant.
                */}
                {(duelTrial?.remaining ?? stats?.trialDuels ?? 1) > 0 &&
                  ` et ${duelTrial?.remaining ?? stats?.trialDuels ?? 1} duel offert`}
              </strong>
              , sans carte bancaire. Ensuite le jeu fonctionne à l'abonnement — à partir de
              2,99 € par mois, le joueur du jour tous les jours plus des parties pour les
              archives et les duels. <Link to="/premium">Voir les formules</Link>.
            </p>
          ))}

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

      {/* Apres les arguments du jeu : on demande une fois qu'on a montre
          ce qu'on propose, jamais avant. */}
      <SupportSection />

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
