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
import Support from './pages/Support.jsx';
import SupportThanks from './pages/SupportThanks.jsx';
import PremiumThanks from './pages/PremiumThanks.jsx';
import { MentionsLegales, Confidentialite, Cookies } from './pages/Legal.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Admin from './pages/Admin.jsx';
import TestFinPartie from './pages/TestFinPartie.jsx';

function Protected({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="spinner" style={{ marginTop: 80 }} />;
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return children;
}

/*
 * Le mur de paiement, côté écran.
 *
 * Il double celui du serveur, il ne le remplace pas : c'est `requirePaid-
 * Access` qui refuse pour de bon, ici on évite seulement d'ouvrir une page
 * dont chaque bouton échouerait. Masquer une page n'a jamais protégé une
 * API, et une API protégée n'a jamais rendu une page agréable.
 *
 * Un joueur sans abonnement part vers l'offre plutôt que vers l'accueil :
 * il a cliqué sur « Jouer », la réponse à ce clic est le prix, pas un
 * renvoi silencieux à la case départ. Le paramètre `requis` permet à la
 * page d'offre de le dire en toutes lettres.
 */
function Subscribed({ children }) {
  const { isAuthenticated, hasAccess, loading } = useAuth();
  if (loading) return <div className="spinner" style={{ marginTop: 80 }} />;
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (!hasAccess) return <Navigate to="/premium?requis=1" replace />;
  return children;
}

/*
 * Le tableau de bord n'est qu'une vue : le serveur reste seul juge et
 * répond 404 à qui n'est pas administrateur. Masquer la page ici évite
 * simplement d'afficher un écran d'erreur à un joueur curieux.
 */
function AdminOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="spinner" style={{ marginTop: 80 }} />;
  if (!user?.isAdmin) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Landing />} />
        {/* Les quatre écrans qui font jouer — donc les quatre qui appellent
            l'API Claude — passent par le mur de paiement. */}
        <Route
          path="/solo"
          element={
            <Subscribed>
              <Solo />
            </Subscribed>
          }
        />
        <Route
          path="/duel"
          element={
            <Subscribed>
              <Matchmaking />
            </Subscribed>
          }
        />
        <Route
          path="/duel/partie"
          element={
            <Subscribed>
              <Arena />
            </Subscribed>
          }
        />
        <Route path="/classement" element={<Leaderboard />} />
        <Route path="/reinitialiser" element={<ResetPassword />} />
        <Route
          path="/archives"
          element={
            <Subscribed>
              <Archive />
            </Subscribed>
          }
        />
        <Route
          path="/archives/:date"
          element={
            <Subscribed>
              <ArchiveGame />
            </Subscribed>
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

        {/* Le soutien est ouvert a tous : aucun compte demande. */}
        <Route path="/soutenir" element={<Support />} />
        <Route path="/soutenir/merci" element={<SupportThanks />} />

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
        <Route
          path="/admin"
          element={
            <AdminOnly>
              <Admin />
            </AdminOnly>
          }
        />
        {/*
          Aperçu de l'écran de fin de partie et de sa fenêtre « Envie de
          rejouer ? ». Publique et sans effet : aucune donnée réelle, aucun
          appel au serveur. C'est le seul moyen de regarder cet écran dans
          ses trois issues sans jouer trois parties.
        */}
        <Route path="/test/fin-de-partie" element={<TestFinPartie />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
