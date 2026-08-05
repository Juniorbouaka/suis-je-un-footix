import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { useAuth } from './lib/auth.jsx';
import Landing from './pages/Landing.jsx';
import Solo from './pages/Solo.jsx';
import Matchmaking from './pages/Matchmaking.jsx';
import Arena from './pages/Arena.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import Profile from './pages/Profile.jsx';
import Archive from './pages/Archive.jsx';
import ArchiveGame from './pages/ArchiveGame.jsx';
import Premium from './pages/Premium.jsx';
import PremiumThanks from './pages/PremiumThanks.jsx';
import { MentionsLegales, Confidentialite, Cookies } from './pages/Legal.jsx';
import ResetPassword from './pages/ResetPassword.jsx';

function Protected({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="spinner" style={{ marginTop: 80 }} />;
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/solo"
          element={
            <Protected>
              <Solo />
            </Protected>
          }
        />
        <Route
          path="/duel"
          element={
            <Protected>
              <Matchmaking />
            </Protected>
          }
        />
        <Route
          path="/duel/partie"
          element={
            <Protected>
              <Arena />
            </Protected>
          }
        />
        <Route path="/classement" element={<Leaderboard />} />
        <Route path="/reinitialiser" element={<ResetPassword />} />
        <Route
          path="/archives"
          element={
            <Protected>
              <Archive />
            </Protected>
          }
        />
        <Route
          path="/archives/:date"
          element={
            <Protected>
              <ArchiveGame />
            </Protected>
          }
        />

        {/* L'offre est publique : on doit pouvoir la lire sans compte. */}
        <Route path="/premium" element={<Premium />} />
        <Route
          path="/premium/merci"
          element={
            <Protected>
              <PremiumThanks />
            </Protected>
          }
        />

        <Route path="/mentions-legales" element={<MentionsLegales />} />
        <Route path="/confidentialite" element={<Confidentialite />} />
        <Route path="/cookies" element={<Cookies />} />
        <Route
          path="/profil"
          element={
            <Protected>
              <Profile />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
