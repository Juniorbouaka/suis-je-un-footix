import { useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useTheme } from '../lib/theme.jsx';
import { closeSocket } from '../lib/socket.js';
import AuthModal from './AuthModal.jsx';
import Icon from './Icon.jsx';
import PitchBackground from './PitchBackground.jsx';
import { ConsentBanner } from './Ads.jsx';

export default function Layout({ children }) {
  const { isAuthenticated, user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [authOpen, setAuthOpen] = useState(false);
  const navigate = useNavigate();

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
                Quitter
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
        <div className="container container-wide row row-between wrap">
          <span>Suis-je un footix ? — proximité sémantique évaluée par Claude.</span>
          <span className="mono">v1.0</span>
        </div>
      </footer>

      <ConsentBanner />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
