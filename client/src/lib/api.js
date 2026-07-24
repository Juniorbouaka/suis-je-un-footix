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
