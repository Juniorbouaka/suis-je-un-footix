import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { api, errorMessage } from '../lib/api.js';

/** Modale d'inscription / connexion (onboarding §7). */
export default function AuthModal({ open, onClose, onSuccess, defaultTab = 'login' }) {
  const { login, signup } = useAuth();
  const [tab, setTab] = useState(defaultTab);
  const [form, setForm] = useState({ username: '', email: '', password: '', identifier: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');

  if (!open) return null;

  const forgot = async () => {
    const email = window.prompt('Ton adresse e-mail :', form.identifier.includes('@') ? form.identifier : '');
    if (!email) return;
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setSent(data.message);
    } catch (err) {
      setError(errorMessage(err, 'Demande impossible.'));
    } finally {
      setBusy(false);
    }
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (tab === 'signup') {
        await signup({ username: form.username, email: form.email, password: form.password });
      } else {
        await login({ identifier: form.identifier, password: form.password });
      }
      if (onSuccess) onSuccess();
      else onClose?.();
    } catch (err) {
      setError(errorMessage(err, 'Connexion impossible.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Authentification">
        <h2 style={{ fontSize: 22, marginBottom: 4 }}>
          {tab === 'signup' ? 'Créer un compte' : 'Content de te revoir'}
        </h2>
        <p className="muted small" style={{ marginBottom: 18 }}>
          {tab === 'signup'
            ? 'Un pseudo, un e-mail, et tu joues.'
            : 'Connecte-toi pour retrouver ta série et ton classement.'}
        </p>

        <div className="tabs">
          <button className={`tab${tab === 'login' ? ' active' : ''}`} onClick={() => setTab('login')}>
            Connexion
          </button>
          <button className={`tab${tab === 'signup' ? ' active' : ''}`} onClick={() => setTab('signup')}>
            Inscription
          </button>
        </div>

        <form onSubmit={submit}>
          {tab === 'signup' ? (
            <>
              <div className="field">
                <label htmlFor="username">Pseudo</label>
                <input
                  id="username"
                  className="input"
                  value={form.username}
                  onChange={set('username')}
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="email">E-mail</label>
                <input
                  id="email"
                  type="email"
                  className="input"
                  value={form.email}
                  onChange={set('email')}
                  autoComplete="email"
                  required
                />
              </div>
            </>
          ) : (
            <div className="field">
              <label htmlFor="identifier">Pseudo ou e-mail</label>
              <input
                id="identifier"
                className="input"
                value={form.identifier}
                onChange={set('identifier')}
                autoComplete="username"
                autoFocus
                required
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="password">Mot de passe</label>
            <input
              id="password"
              type="password"
              className="input"
              value={form.password}
              onChange={set('password')}
              autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
              minLength={tab === 'signup' ? 8 : undefined}
              required
            />
            {tab === 'signup' && <span className="small faint">8 caractères minimum.</span>}
          </div>

          {error && (
            <div className="alert alert-error" style={{ marginBottom: 14 }}>
              {error}
            </div>
          )}

          {sent && (
            <div className="alert alert-info" style={{ marginBottom: 14 }}>
              {sent}
            </div>
          )}

          <button className="btn btn-block" disabled={busy}>
            {busy ? 'Un instant…' : tab === 'signup' ? 'Créer mon compte' : 'Se connecter'}
          </button>
        </form>

        {tab === 'login' && (
          <button
            className="btn-icon btn-text"
            style={{ display: 'block', margin: '12px auto 0' }}
            onClick={forgot}
            disabled={busy}
          >
            Mot de passe oublié ?
          </button>
        )}

        <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onClose}>
          Annuler
        </button>
      </div>
    </div>
  );
}
