import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { api, errorMessage } from '../lib/api.js';
import { closeSocket } from '../lib/socket.js';
import Icon from '../components/Icon.jsx';
import PremiumBadge from '../components/PremiumBadge.jsx';
import SupporterBadge from '../components/SupporterBadge.jsx';
import SubscriptionCard from '../components/SubscriptionCard.jsx';
import ThemePicker from '../components/ThemePicker.jsx';
import DetailedStats from '../components/DetailedStats.jsx';

export default function Profile() {
  const { user, stats, rank, achievements, logout, isPremium } = useAuth();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const destroy = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.delete('/auth/me', { data: { password } });
      closeSocket();
      await logout();
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const earned = achievements.filter((a) => a.earned).length;
  const duels = (stats?.pvpWins ?? 0) + (stats?.pvpLosses ?? 0);
  const winRate = duels > 0 ? Math.round((stats.pvpWins / duels) * 100) : null;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row" style={{ gap: 16 }}>
          <span className="avatar avatar-lg">{(user?.username || '?')[0].toUpperCase()}</span>
          <div className="grow">
            <h1 className="row" style={{ fontSize: 24, gap: 7 }}>
              {user?.username}
              {isPremium && <PremiumBadge size={15} />}
              {user?.isSupporter && <SupporterBadge size={14} />}
            </h1>
            <p className="muted small">
              {rank?.name}
              {rank?.next && ` · encore ${rank.toNext} partie(s) pour ${rank.next}`}
            </p>
          </div>
          <span className="pill pill-blue">
            {earned}/{achievements.length} médailles
          </span>
        </div>

        <div className="stat-grid" style={{ marginTop: 20 }}>
          <div className="stat">
            <div className="stat-value">{stats?.daysCompleted ?? 0}</div>
            <div className="stat-label">Jours complétés</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats?.totalScore ?? 0}</div>
            <div className="stat-label">Points cumulés</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats?.currentStreak ?? 0}</div>
            <div className="stat-label">Série en cours</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats?.bestStreak ?? 0}</div>
            <div className="stat-label">Meilleure série</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats?.bestAttempts ?? '—'}</div>
            <div className="stat-label">Record tentatives</div>
          </div>
          <div className="stat">
            <div className="stat-value">
              {stats?.pvpWins ?? 0}
              <span className="faint">/{duels}</span>
            </div>
            <div className="stat-label">Duels gagnés{winRate !== null ? ` (${winRate} %)` : ''}</div>
          </div>
        </div>
      </div>

      <SubscriptionCard />

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row row-between wrap" style={{ marginBottom: 14, gap: 10 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>
            <Icon name="chart" size={16} /> Statistiques détaillées
          </h2>
          {!isPremium && (
            <span className="pill faint">
              <Icon name="lock" size={12} /> premium
            </span>
          )}
        </div>

        {isPremium ? (
          <DetailedStats />
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            Ta progression mois par mois, la répartition de tes tentatives et l'issue de chacune de
            tes parties. <Link to="/premium">Voir le premium</Link>.
          </p>
        )}
      </div>

      <ThemePicker />

      <div className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, marginBottom: 14 }}>Médailles</h2>
        <div className="badge-grid">
          {achievements.map((a) => (
            <div key={a.code} className={`badge${a.earned ? ' earned' : ''}`}>
              <span className="badge-icon">
                <Icon name="medal" size={20} />
              </span>
              <div>
                <div className="badge-name">{a.name}</div>
                <div className="badge-desc">{a.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="danger-zone">
        <h2 style={{ fontSize: 16, marginBottom: 6 }}>Supprimer mon compte</h2>
        <p className="muted small" style={{ marginBottom: 14 }}>
          Ton compte, tes parties, tes scores et tes médailles sont effacés définitivement.
          Cette action est irréversible.
        </p>

        {confirming ? (
          <form onSubmit={destroy} className="stack-sm">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="delpw">Confirme avec ton mot de passe</label>
              <input
                id="delpw"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn-danger grow" disabled={busy || !password}>
                {busy ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setConfirming(false);
                  setPassword('');
                  setError('');
                }}
              >
                Annuler
              </button>
            </div>
          </form>
        ) : (
          <button className="btn btn-danger btn-sm" onClick={() => setConfirming(true)}>
            Supprimer mon compte
          </button>
        )}
      </div>
    </div>
  );
}
