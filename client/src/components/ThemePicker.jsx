import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Icon from './Icon.jsx';

/**
 * Choix du décor de terrain.
 *
 * Le serveur ne stocke qu'une clé ; tout le rendu est en CSS, sous
 * [data-pitch='<clé>']. Un thème verrouillé reste visible et survolable :
 * on montre ce qu'on vend plutôt que de le cacher.
 */
export default function ThemePicker() {
  const { user, isPremium, refreshProfile } = useAuth();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['themes'],
    queryFn: async () => (await api.get('/themes')).data,
  });

  const actuel = user?.pitchTheme || 'classique';

  const choisir = async (theme) => {
    if (theme.premium && !isPremium) return;
    setBusy(theme.key);
    setError('');
    try {
      await api.put('/me/theme', { theme: theme.key });
      await refreshProfile();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const themes = data?.themes || [];
  if (!themes.length) return null;

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="row row-between wrap" style={{ marginBottom: 14, gap: 10 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>
          <Icon name="palette" size={16} /> Décor du terrain
        </h2>
        {!isPremium && (
          <Link to="/premium" className="small">
            Débloquer les quatre décors
          </Link>
        )}
      </div>

      <div className="theme-grid">
        {themes.map((theme) => {
          const verrouille = theme.premium && !isPremium;
          const actif = theme.key === actuel;

          return (
            <button
              key={theme.key}
              className={`theme-card${actif ? ' active' : ''}${verrouille ? ' locked' : ''}`}
              onClick={() => choisir(theme)}
              disabled={verrouille || Boolean(busy)}
              title={verrouille ? 'Réservé au premium' : theme.hint}
              aria-pressed={actif}
            >
              <span className="theme-preview" data-pitch-preview={theme.key} aria-hidden="true" />
              <span className="theme-name">
                {theme.label}
                {verrouille && <Icon name="lock" size={12} />}
                {actif && <Icon name="check" size={13} />}
              </span>
              <span className="theme-hint small faint">{theme.hint}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}
