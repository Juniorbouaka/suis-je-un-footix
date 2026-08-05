import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import PremiumBadge from '../components/PremiumBadge.jsx';

/* -------------------------------------------------------------- *
 *  Dates : le serveur renvoie de l'UTC SQLite (« 2026-08-05 09:12:00 »).
 *  Sans le marqueur de fuseau, le navigateur le lirait comme une heure
 *  locale et décalerait tout l'affichage.
 * -------------------------------------------------------------- */

function parseUtc(value) {
  if (!value) return null;
  const iso = value.includes('T') ? value : value.replace(' ', 'T');
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(value) {
  const d = parseUtc(value);
  if (!d) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' });
}

function ago(value) {
  const d = parseUtc(value);
  if (!d) return 'jamais';
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 90) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

const dayLabel = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

/* -------------------------------------------------------------- *
 *  Graphique : des barres, rien de plus. Une dépendance de courbes
 *  pèserait plus lourd que le reste de la page.
 * -------------------------------------------------------------- */

const METRICS = [
  { key: 'logins', label: 'Connexions' },
  { key: 'signups', label: 'Inscriptions' },
  { key: 'activeAccounts', label: 'Joueurs actifs' },
  { key: 'guesses', label: 'Tentatives' },
];

function Chart({ series, metric }) {
  const max = Math.max(1, ...series.map((d) => d[metric]));

  return (
    <>
      <div className="chart" role="img" aria-label={`Évolution — ${metric}`}>
        {series.map((d) => (
          <div className="chart-col" key={d.date} title={`${dayLabel(d.date)} — ${d[metric]}`}>
            <span className="chart-count">{d[metric] || ''}</span>
            <div
              className={`chart-bar${d[metric] ? '' : ' is-empty'}`}
              style={{ height: `${Math.round((d[metric] / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="chart-axis small faint mono">
        <span>{dayLabel(series[0]?.date || '')}</span>
        <span>max {max}</span>
        <span>{dayLabel(series[series.length - 1]?.date || '')}</span>
      </div>
    </>
  );
}

function Kpi({ value, label, hint }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && (
        <div className="small faint" style={{ marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- *
 *  Page
 * -------------------------------------------------------------- */

export default function Admin() {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState('logins');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-stats', days],
    queryFn: async () => (await api.get(`/admin/stats?days=${days}`)).data,
    refetchInterval: 60_000,
  });

  const { data: users } = useQuery({
    queryKey: ['admin-users', search],
    queryFn: async () =>
      (await api.get(`/admin/users?limit=50${search ? `&q=${encodeURIComponent(search)}` : ''}`)).data,
  });

  if (isLoading) return <div className="spinner" style={{ marginTop: 80 }} />;
  if (error) {
    return (
      <div className="alert alert-error" style={{ maxWidth: 520, margin: '60px auto' }}>
        Statistiques indisponibles. Vérifie que ton adresse figure bien dans ADMIN_EMAILS.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div className="row row-between wrap" style={{ marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 26 }}>Tableau de bord</h1>
          <p className="muted small">
            {data.live.online} en ligne · pic {data.live.peak} depuis le dernier démarrage · journée{' '}
            {data.date} (UTC)
          </p>
        </div>
        <div className="tabs" style={{ width: 260, marginBottom: 0 }}>
          {[7, 30, 90].map((n) => (
            <button key={n} className={`tab${days === n ? ' active' : ''}`} onClick={() => setDays(n)}>
              {n} j
            </button>
          ))}
        </div>
      </div>

      {/* --- Comptes ------------------------------------------------ */}
      <h2 className="admin-title">Comptes</h2>
      <div className="stat-grid" style={{ marginBottom: 22 }}>
        <Kpi value={data.users.total} label="Inscrits" hint={`+${data.users.today} aujourd’hui`} />
        <Kpi value={data.users.last7} label="Nouveaux (7 j)" hint={`${data.users.last30} sur 30 j`} />
        <Kpi
          value={data.users.dormant}
          label="Jamais joué"
          hint={`${Math.round((data.users.dormant / Math.max(1, data.users.total)) * 100)} % des comptes`}
        />
        <Kpi value={`${data.loyalty.rate} %`} label="Reviennent" hint={`${data.loyalty.returning} sur ${data.loyalty.played} joueurs`} />
      </div>

      {/* --- Connexions --------------------------------------------- */}
      <h2 className="admin-title">Connexions et activité</h2>
      <div className="stat-grid" style={{ marginBottom: 22 }}>
        <Kpi value={data.logins.today} label="Connexions aujourd’hui" />
        <Kpi value={data.logins.last7} label="Connexions (7 j)" hint={`${data.logins.uniqueLast7} comptes distincts`} />
        <Kpi value={data.active.today} label="Ont joué aujourd’hui" />
        <Kpi value={data.active.last7} label="Ont joué (7 j)" hint={`${data.active.last30} sur 30 j`} />
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <div className="row row-between wrap" style={{ marginBottom: 14, gap: 10 }}>
          <h3 style={{ fontSize: 16 }}>Évolution sur {data.days} jours</h3>
          <div className="row" style={{ gap: 6 }}>
            {METRICS.map((m) => (
              <button
                key={m.key}
                className={`btn btn-sm${metric === m.key ? '' : ' btn-ghost'}`}
                onClick={() => setMetric(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <Chart series={data.series} metric={metric} />
      </div>

      {/* --- Argent -------------------------------------------------- */}
      <h2 className="admin-title">Revenus et coûts</h2>
      <div className="stat-grid" style={{ marginBottom: 22 }}>
        <Kpi
          value={data.premium.active}
          label="Abonnés"
          hint={`${data.premium.monthly} mensuel · ${data.premium.yearly} annuel`}
        />
        <Kpi
          value={data.premium.cancelled}
          label="Résiliations en cours"
          hint="accès jusqu’à l’échéance payée"
        />
        <Kpi value={`${data.donations.total} €`} label="Dons encaissés" hint={`${data.donations.count} dons`} />
        <Kpi
          value={data.budget.used}
          label="Appels Claude aujourd’hui"
          hint={data.budget.limit ? `plafond ${data.budget.limit}` : 'sans plafond'}
        />
      </div>

      {/* --- Journal ------------------------------------------------- */}
      <div className="admin-cols">
        <div className="card">
          <h3 style={{ fontSize: 16, marginBottom: 12 }}>Derniers inscrits</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Joueur</th>
                <th style={{ textAlign: 'right' }}>Parties</th>
                <th style={{ textAlign: 'right' }}>Vu</th>
              </tr>
            </thead>
            <tbody>
              {data.latestSignups.map((u) => (
                <tr key={u.username}>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      {u.username}
                      {u.isPremium && <PremiumBadge size={12} />}
                    </span>
                    <span className="small faint">inscrit le {formatDate(u.createdAt)}</span>
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {u.games}
                  </td>
                  <td className="small faint" style={{ textAlign: 'right' }}>
                    {ago(u.lastSeenAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 style={{ fontSize: 16, marginBottom: 12 }}>Dernières connexions</h3>
          {data.latestLogins.length === 0 ? (
            <p className="muted small center" style={{ padding: '20px 0' }}>
              Rien encore — le journal démarre avec cette version.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Joueur</th>
                  <th style={{ textAlign: 'right' }}>Quand</th>
                </tr>
              </thead>
              <tbody>
                {data.latestLogins.map((l, i) => (
                  <tr key={i}>
                    <td>
                      {l.username}
                      {l.kind === 'signup' && <span className="pill pill-green small"> nouveau</span>}
                    </td>
                    <td className="small faint" style={{ textAlign: 'right' }}>
                      {ago(l.at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* --- Annuaire ------------------------------------------------ */}
      <div className="card" style={{ marginTop: 22 }}>
        <div className="row row-between wrap" style={{ marginBottom: 14, gap: 10 }}>
          <h3 style={{ fontSize: 16 }}>Comptes {users ? `(${users.total})` : ''}</h3>
          <form
            className="row"
            style={{ gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(query.trim());
            }}
          >
            <input
              className="input"
              style={{ width: 220 }}
              placeholder="pseudo ou e-mail…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="btn btn-sm">
              <Icon name="target" size={14} /> Chercher
            </button>
          </form>
        </div>

        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Joueur</th>
                <th>E-mail</th>
                <th style={{ textAlign: 'right' }}>Parties</th>
                <th style={{ textAlign: 'right' }}>Connexions</th>
                <th style={{ textAlign: 'right' }}>Dernière visite</th>
              </tr>
            </thead>
            <tbody>
              {(users?.entries || []).map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      {u.username}
                      {u.isPremium && <PremiumBadge size={12} />}
                    </span>
                    <span className="small faint">
                      inscrit le {formatDate(u.createdAt)}
                      {u.plan ? ` · ${u.plan === 'yearly' ? 'annuel' : 'mensuel'}` : ''}
                    </span>
                  </td>
                  <td className="small muted">{u.email}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {u.games}
                  </td>
                  <td className="mono faint" style={{ textAlign: 'right' }}>
                    {u.logins}
                  </td>
                  <td className="small faint" style={{ textAlign: 'right' }}>
                    {ago(u.lastSeenAt || u.lastLoginAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {users && users.entries.length === 0 && (
          <p className="muted small center" style={{ padding: '20px 0' }}>
            Aucun compte ne correspond.
          </p>
        )}
      </div>

      <p className="small faint center" style={{ marginTop: 18 }}>
        Chiffres calculés à partir de la base du jeu — aucun traceur tiers.
      </p>
    </div>
  );
}
