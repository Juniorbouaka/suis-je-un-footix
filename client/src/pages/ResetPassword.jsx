import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.js';
import Icon from '../components/Icon.jsx';

/** Page atteinte depuis le lien reçu par e-mail : /reinitialiser?token=… */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) return setError('Les deux mots de passe ne correspondent pas.');
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
      setTimeout(() => navigate('/'), 2500);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div style={{ maxWidth: 460, margin: '40px auto' }}>
        <div className="card center">
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>Lien incomplet</h1>
          <p className="muted small">
            Ce lien ne contient pas de jeton. Refais une demande depuis la fenêtre de connexion.
          </p>
          <Link to="/" className="btn" style={{ marginTop: 16 }}>
            Retour à l’accueil
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 460, margin: '40px auto' }}>
      <div className="card">
        <h1 style={{ fontSize: 23, marginBottom: 6 }}>Nouveau mot de passe</h1>
        <p className="muted small" style={{ marginBottom: 20 }}>
          Choisis-en un nouveau. Toutes tes sessions ouvertes seront fermées.
        </p>

        {done ? (
          <div className="center stack-sm">
            <div className="result-icon">
              <Icon name="check" size={34} strokeWidth={2} />
            </div>
            <p style={{ fontWeight: 700, marginTop: 10 }}>Mot de passe modifié</p>
            <p className="muted small">Retour à l’accueil…</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="pw">Mot de passe</label>
              <input
                id="pw"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                autoFocus
                required
              />
              <span className="small faint">8 caractères minimum.</span>
            </div>

            <div className="field">
              <label htmlFor="pw2">Confirmation</label>
              <input
                id="pw2"
                type="password"
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            {error && <div className="alert alert-error" style={{ marginBottom: 14 }}>{error}</div>}

            <button className="btn btn-block" disabled={busy || !password}>
              {busy ? 'Un instant…' : 'Valider'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
