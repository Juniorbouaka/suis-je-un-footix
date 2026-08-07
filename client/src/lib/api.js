import axios from 'axios';

const STORAGE_KEY = 'footix.session';

export function readSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

export function writeSession(session) {
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(STORAGE_KEY);
}

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((cfg) => {
  const session = readSession();
  if (session?.accessToken) cfg.headers.Authorization = `Bearer ${session.accessToken}`;
  return cfg;
});

/* Rafraîchissement automatique de l'access token (stratégie refresh token). */
let refreshing = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const session = readSession();

    /*
     * Le serveur vient de fermer la porte : l'abonnement a expiré, ou il a
     * été résilié depuis un autre appareil. L'événement prévient
     * l'application, qui relit le profil et bascule sur l'offre — sinon
     * l'écran reste celui d'un abonné et chaque clic échoue en silence.
     *
     * On ne redirige pas d'ici : une bibliothèque HTTP qui décide de la
     * navigation est une source de surprises. On signale, l'application
     * décide.
     */
    if (error.response?.status === 402 && error.response.data?.needsSubscription) {
      window.dispatchEvent(new Event('footix:needs-subscription'));
    }

    if (error.response?.status !== 401 || original?._retried || !session?.refreshToken) {
      return Promise.reject(error);
    }

    original._retried = true;
    refreshing ??= axios
      .post('/api/auth/refresh', { refreshToken: session.refreshToken })
      .then(({ data }) => {
        writeSession(data);
        return data;
      })
      .catch((err) => {
        writeSession(null);
        window.dispatchEvent(new Event('footix:signed-out'));
        throw err;
      })
      .finally(() => {
        refreshing = null;
      });

    try {
      const fresh = await refreshing;
      original.headers.Authorization = `Bearer ${fresh.accessToken}`;
      return api(original);
    } catch {
      return Promise.reject(error);
    }
  }
);

export function errorMessage(error, fallback = 'Une erreur est survenue.') {
  return error?.response?.data?.error || error?.message || fallback;
}

/**
 * Ce refus est-il un mur de paiement — c'est-à-dire « prends un abonnement » ?
 *
 * À distinguer soigneusement de `sansCredit` ci-dessous : les deux répondent
 * 402, mais l'un se règle en s'abonnant et l'autre en attendant la recharge.
 * Proposer l'abonnement à quelqu'un qui paie déjà est la meilleure façon de
 * le faire résilier.
 */
export function murPaiement(error) {
  return Boolean(error?.response?.data?.needsSubscription);
}

/** Ce refus est-il un portefeuille vide ? Le solde à jour vient avec. */
export function sansCredit(error) {
  return Boolean(error?.response?.data?.needsCredits);
}

/** Le portefeuille joint à une réponse d'erreur, s'il y en a un. */
export function creditsDeLErreur(error) {
  return error?.response?.data?.credits || null;
}
