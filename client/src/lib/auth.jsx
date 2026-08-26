import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, readSession, writeSession } from './api.js';
import { oublierCredits, publierCredits } from './credits.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => readSession());
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(Boolean(readSession()));

  const refreshProfile = useCallback(async () => {
    if (!readSession()) {
      setProfile(null);
      return null;
    }
    try {
      const { data } = await api.get('/auth/me');
      setProfile(data);
      /*
       * Le portefeuille du profil est publié dans le dépôt commun.
       *
       * Il vient du serveur, il est donc au moins aussi frais que ce qui y
       * est déjà. Sans cette ligne, un abonné qui passe à l'Illimité avec un
       * solde à zéro verrait toujours zéro dans l'en-tête : le profil aurait
       * le bon chiffre, mais le dépôt garderait l'ancien — et c'est le dépôt
       * qui gagne, par construction.
       */
      publierCredits(data?.billing?.credits);
      return data;
    } catch {
      setProfile(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await refreshProfile();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [refreshProfile]);

  useEffect(() => {
    const onSignedOut = () => {
      setSession(null);
      setProfile(null);
      // Une session qui expire est une session qui se termine : le solde
      // appartenait à ce compte-là, il ne doit pas s'afficher au suivant.
      oublierCredits();
    };
    window.addEventListener('footix:signed-out', onSignedOut);
    return () => window.removeEventListener('footix:signed-out', onSignedOut);
  }, []);

  /*
   * Le serveur a refusé un appel faute d'abonnement : on relit le profil.
   *
   * Le cas se produit pour de bon — un abonnement qui expire pendant qu'un
   * onglet reste ouvert, une résiliation depuis un autre appareil. Sans
   * cette relecture, l'interface continue d'afficher le jeu à quelqu'un qui
   * n'y a plus droit, et chaque clic échoue sans explication.
   */
  useEffect(() => {
    const onPaywall = () => {
      refreshProfile();
    };
    window.addEventListener('footix:needs-subscription', onPaywall);
    return () => window.removeEventListener('footix:needs-subscription', onPaywall);
  }, [refreshProfile]);

  const persist = useCallback(async (data) => {
    writeSession(data);
    setSession(data);
    const { data: me } = await api.get('/auth/me');
    setProfile(me);
    publierCredits(me?.billing?.credits);
    return me;
  }, []);

  const signup = useCallback(
    async (payload) => {
      const { data } = await api.post('/auth/signup', payload);
      return persist(data);
    },
    [persist]
  );

  const login = useCallback(
    async (payload) => {
      const { data } = await api.post('/auth/login', payload);
      return persist(data);
    },
    [persist]
  );

  const logout = useCallback(async () => {
    const current = readSession();
    writeSession(null);
    setSession(null);
    setProfile(null);
    oublierCredits();
    if (current?.refreshToken) {
      api.post('/auth/logout', { refreshToken: current.refreshToken }).catch(() => {});
    }
  }, []);

  const value = useMemo(
    () => ({
      session,
      profile,
      user: profile?.user || session?.user || null,
      stats: profile?.stats || null,
      rank: profile?.rank || null,
      achievements: profile?.achievements || [],
      isPremium: Boolean(profile?.user?.isPremium),
      /*
       * Deux droits distincts, et les confondre coûterait cher dans les deux
       * sens : `hasAccess` dit « il a payé, il peut jouer », `isPremium` dit
       * « il a le forfait Illimité ». Un abonné Accès a le premier sans le
       * second — le mur de paiement doit le laisser entrer, la carte des
       * thèmes doit rester fermée.
       *
       * Tant que le profil n'est pas chargé, on ne conclut rien : `loading`
       * est là pour ça. Répondre « non » par défaut ferait clignoter le mur
       * de paiement devant un abonné à chaque rechargement de page.
       */
      hasAccess: Boolean(profile?.billing?.hasAccess ?? profile?.user?.hasAccess),
      /*
       * Le droit d'OUVRIR la partie du jour, abonnement ou essai gratuit.
       *
       * Un troisième droit et pas un synonyme du deuxième : `hasAccess`
       * commande l'offre et les archives, `canPlay` ne commande que la
       * porte du mot du jour, et le duel a la sienne (`canDuel`). Les
       * confondre rouvrirait aux huit chances d'essai des parties qui se
       * paient en crédits.
       */
      canPlay: Boolean(profile?.billing?.canPlay ?? profile?.user?.canPlay),
      // Ce qui reste de l'essai. `active` dit s'il y a lieu d'en parler :
      // un abonné a un compteur comme tout le monde, l'écran doit se taire.
      trial: profile?.billing?.trial || profile?.user?.trial || null,
      /*
       * Le droit d'ouvrir un DUEL — abonnement ou duel offert.
       *
       * Un quatrième droit, et le quatrième refus de les confondre. Le jeu
       * donne à essayer deux choses qui s'épuisent séparément : huit
       * chances sur le mot du jour, et un duel entier. Celui qui a brûlé
       * ses chances garde son duel, celui qui a joué son duel garde ses
       * chances — un seul drapeau aurait fermé les deux portes d'un coup.
       */
      canDuel: Boolean(profile?.billing?.canDuel ?? profile?.user?.canDuel),
      duelTrial: profile?.billing?.duelTrial || profile?.user?.duelTrial || null,
      plan: profile?.billing?.plan || null,
      planLabel: profile?.billing?.planLabel || null,
      // Le portefeuille tel que le serveur l'a renvoyé avec le profil. Les
      // écrans de jeu reçoivent une version plus fraîche à chaque partie ;
      // celle-ci sert d'en-tête et de valeur de départ.
      credits: profile?.billing?.credits || null,
      billing: profile?.billing || null,
      isAuthenticated: Boolean(session?.accessToken),
      loading,
      signup,
      login,
      logout,
      refreshProfile,
    }),
    [session, profile, loading, signup, login, logout, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}
