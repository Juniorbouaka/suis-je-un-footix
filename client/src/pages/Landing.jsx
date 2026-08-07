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
  const { isAuthenticated, hasAccess } = useAuth();
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
   * pour un abonné, l'offre pour les autres, la création de compte pour un
   * visiteur.
   *
   * Envoyer tout le monde vers /solo pour laisser le mur de paiement rebondir
   * marcherait aussi, mais ferait clignoter un écran de jeu avant la
   * redirection — l'impression d'une porte qu'on ouvre puis qu'on referme au
   * nez. Autant nommer le prix tout de suite.
   */
  const go = (path) => {
    setIntent(path);
    if (!isAuthenticated) return setAuthOpen(true);
    navigate(hasAccess ? path : '/premium?requis=1');
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
          Le prix, dès la première page.
          Chaque proposition est un appel d'IA facturé : le jeu ne peut pas
          être gratuit, et le laisser croire pour l'annoncer trois écrans plus
          loin serait la façon la plus sûre de perdre quelqu'un — non pas
          parce qu'il refuse de payer, mais parce qu'on ne le lui avait pas dit.
        */}
        {!hasAccess && (
          <p className="small muted" style={{ marginTop: 14 }}>
            <Icon name="crown" size={13} /> Le jeu fonctionne à l'abonnement — à partir de 2,99 €
            par mois, un stock de parties à dépenser comme tu veux.{' '}
            <Link to="/premium">Voir les formules</Link>.
          </p>
        )}

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
