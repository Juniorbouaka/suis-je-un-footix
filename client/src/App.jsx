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
 * La porte du mot du jour — abonnement OU essai encore ouvert.
 *
 * Elle double `requirePlayAccess` côté serveur, comme `Subscribed` double
 * le mur de paiement, et pour la même raison : éviter d'afficher un écran
 * dont chaque bouton échouerait. Le refus qui compte reste celui du
 * serveur.
 *
 * Deux portes et non une, parce que le jeu vend deux choses différentes :
 * l'essai ouvre la vitrine — huit chances sur le joueur du jour — et rien
 * d'autre. Les archives et les duels se paient en crédits et continuent de
 * passer par `Subscribed` : si `canPlay` gardait tout, l'essai offrirait
 * des parties qui coûtent de l'argent à servir.
 *
 * L'essai épuisé mène à l'offre en le disant : `essai=epuise` change les
 * mots de la page, parce qu'on ne parle pas de la même façon à quelqu'un
 * qui vient de jouer huit coups et à quelqu'un dont l'abonnement a expiré.
 */
function Essayable({ children }) {
  const { isAuthenticated, canPlay, hasAccess, trial, loading } = useAuth();
  if (loading) return <div className="spinner" style={{ marginTop: 80 }} />;
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (!canPlay) {
    const motif = !hasAccess && trial?.exhausted ? 'essai=epuise' : 'requis=1';
    return <Navigate to={`/premium?${motif}`} replace />;
  }
  return children;
}

/*
 * La porte du duel — abonnement OU duel offert.
 *
 * La troisième porte du jeu, et la troisième pour la même raison que les
 * deux autres : ce qu'on laisse essayer n'est pas ce qu'on vend. `Essayable`
 * ouvre le mot du jour à huit chances, celle-ci ouvre UN duel entier, et
 * `Subscribed` garde les archives, qui n'ont rien à démontrer de plus.
 *
 * Elle double la poignée de main de la socket, comme les autres doublent
 * leur middleware, et pour la même raison : éviter d'afficher un écran de
 * recherche d'adversaire à quelqu'un dont la connexion sera refusée. Le
 * refus qui compte reste celui du serveur.
 *
 * Le duel offert déjà joué mène à l'offre en le disant : `duel=epuise`
 * change les mots de la page. On ne parle pas de la même façon à quelqu'un
 * qui vient de perdre un duel de justesse et à quelqu'un qui n'a jamais
 * rien vu du jeu.
 */
function Duellable({ children }) {
  const { isAuthenticated, canDuel, hasAccess, duelTrial, loading } = useAuth();
  if (loading) return <div className="spinner" style={{ marginTop: 80 }} />;
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (!canDuel) {
    const motif = !hasAccess && duelTrial?.exhausted ? 'duel=epuise' : 'requis=1';
    return <Navigate to={`/premium?${motif}`} replace />;
  }
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
            l'API Claude — passent par un mur, et ils n'ont pas tous le même.
            Le mot du jour laisse entrer huit chances d'essai, le duel laisse
            entrer une partie offerte, les archives ne laissent entrer
            personne : elles ne montrent rien que le mot du jour ne montre
            déjà, et ne se paient donc qu'en crédits. */}
        <Route
          path="/solo"
          element={
            <Essayable>
              <Solo />
            </Essayable>
          }
        />
        <Route
          path="/duel"
          element={
            <Duellable>
              <Matchmaking />
            </Duellable>
          }
        />
        {/*
          L'arène n'est PAS derrière `Duellable`, et c'est délibéré : le duel
          offert est consommé à la formation du salon, donc dès la première
          seconde de la partie. Le garde y verrait un droit épuisé et
          renverrait vers l'offre le joueur en train de jouer sa partie
          gratuite — un rechargement de page suffirait à le mettre dehors et
          à le déclarer forfait.
          Rien n'est ouvert pour autant : l'arène demande son salon au
          serveur dès l'affichage, et `no-room` la renvoie vers /duel, où le
          garde reprend la main. C'est le serveur qui dit s'il y a une
          partie, pas un drapeau lu dans le profil.
        */}
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
