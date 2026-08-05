import { useEffect, useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useTheme } from '../lib/theme.jsx';
import { closeSocket } from '../lib/socket.js';
import AuthModal from './AuthModal.jsx';
import Icon from './Icon.jsx';
import PremiumBadge from './PremiumBadge.jsx';
import PitchBackground from './PitchBackground.jsx';
import { ConsentBanner } from './Ads.jsx';

export default function Layout({ children }) {
  const { isAuthenticated, user, isPremium, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [authOpen, setAuthOpen] = useState(false);
  const navigate = useNavigate();

  // Le décor de terrain vit sur la racine du document : tout le CSS s'y
  // accroche via [data-pitch]. Il est ici, et non dans ThemeProvider, parce
  // qu'il dépend du compte connecté.
  const pitch = user?.pitchTheme || 'classique';
  useEffect(() => {
    document.documentElement.dataset.pitch = pitch;
  }, [pitch]);

  const signOut = async () => {
    closeSocket();
    await logout();
    navigate('/');
  };

  return (
    <div className="app">
      <PitchBackground />

      <header className="header">
        <div className="container container-wide header-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">Suis-je un footix&nbsp;?</span>
          </Link>

          <nav className="nav">
            {isAuthenticated && (
              <>
                <NavLink to="/solo" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                  Solo
                </NavLink>
                <NavLink to="/duel" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                  Duel
                </NavLink>
                <NavLink to="/archives" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                  Archives
                </NavLink>
              </>
            )}
            <NavLink to="/classement" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              Classement
            </NavLink>
            {isAuthenticated && (
              <NavLink to="/profil" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                Profil
              </NavLink>
            )}

            {!isPremium && (
              <NavLink
                to="/premium"
                className={({ isActive }) => `nav-link nav-premium${isActive ? ' active' : ''}`}
              >
                <Icon name="crown" size={14} /> Premium
              </NavLink>
            )}

            <button
              className="btn-icon"
              onClick={toggle}
              title={theme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'}
              aria-label="Changer de thème"
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>

            {isAuthenticated ? (
              <button className="btn btn-ghost" onClick={signOut} title={user?.username}>
                {isPremium && <PremiumBadge size={12} />} Quitter
              </button>
            ) : (
              <button className="btn" onClick={() => setAuthOpen(true)}>
                Se connecter
              </button>
            )}
          </nav>
        </div>
      </header>

      <main>
        <div className="container container-wide">{children}</div>
      </main>

      <footer className="footer">
        <div className="container container-wide stack-sm">
          <div className="row row-between wrap" style={{ gap: 10 }}>
            <span>Suis-je un footix ? — proximité sémantique évaluée par Claude.</span>
            <span className="mono">v1.0</span>
          </div>
          <nav className="footer-links small">
            <Link to="/premium">Premium</Link>
            <Link to="/mentions-legales">Mentions légales</Link>
            <Link to="/confidentialite">Confidentialité</Link>
            <Link to="/cookies">Cookies</Link>
            <Link to="/soutenir">
              <Icon name="heart" size={12} /> Soutenir le jeu
            </Link>
          </nav>
        </div>
      </footer>

      <ConsentBanner />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
