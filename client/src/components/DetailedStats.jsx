import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';

/**
 * Statistiques détaillées (premium).
 *
 * Trois lectures, trois formes différentes :
 *   — les totaux sont des nombres, pas un graphique ;
 *   — la répartition des tentatives est une grandeur → barres ;
 *   — la progression est une évolution dans le temps → courbe.
 *
 * Une seule série partout, donc aucune légende : le titre nomme la donnée.
 * Les couleurs de l'encre viennent de --chart-ink, vérifiée à 3:1 minimum
 * sur les deux fonds (clair et sombre).
 */

const MOIS = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
];

function moisCourt(iso) {
  const [an, mois] = iso.split('-');
  return `${MOIS[Number(mois) - 1]} ${an.slice(2)}`;
}

function duree(secondes) {
  if (secondes == null) return '—';
  const m = Math.floor(secondes / 60);
  const s = secondes % 60;
  return m ? `${m} min ${String(s).padStart(2, '0')}` : `${s} s`;
}

/* ---------------------------------------------------------------- *
 *  Répartition des tentatives — barres horizontales, série unique
 * ---------------------------------------------------------------- */

function Repartition({ distribution }) {
  const max = Math.max(1, ...distribution.map((d) => d.count));
  const total = distribution.reduce((s, d) => s + d.count, 0);

  if (!total) {
    return <p className="muted small">Aucune partie gagnée pour l'instant.</p>;
  }

  return (
    <div className="chart-bars">
      {distribution.map((bucket) => {
        const part = Math.round((bucket.count / total) * 100);
        return (
          <div
            key={bucket.label}
            className="chart-bar-row"
            title={`${bucket.count} partie${bucket.count > 1 ? 's' : ''} en ${bucket.label} tentatives (${part} %)`}
          >
            <span className="chart-bar-label mono">{bucket.label}</span>
            <div className="chart-bar-track">
              <div
                className="chart-bar-fill"
                style={{ width: `${(bucket.count / max) * 100}%` }}
              />
            </div>
            {/* Valeur en encre de texte, jamais dans la couleur de la série. */}
            <span className="chart-bar-value mono">{bucket.count}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- *
 *  Progression mensuelle — courbe, série unique
 * ---------------------------------------------------------------- */

function Progression({ byMonth }) {
  const [survol, setSurvol] = useState(null);

  const geo = useMemo(() => {
    if (byMonth.length < 2) return null;

    const W = 560;
    const H = 170;
    const padX = 34;
    const padY = 18;

    const scores = byMonth.map((m) => m.averageScore);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const span = max - min || 1;

    const points = byMonth.map((m, i) => ({
      ...m,
      x: padX + (i * (W - padX * 2)) / (byMonth.length - 1),
      y: padY + (1 - (m.averageScore - min) / span) * (H - padY * 2),
    }));

    return { W, H, points, min, max };
  }, [byMonth]);

  if (!geo) {
    return (
      <p className="muted small">
        Il faut au moins deux mois de parties pour tracer une progression.
      </p>
    );
  }

  const { W, H, points, min, max } = geo;
  const trace = points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');

  return (
    <div className="chart-line-wrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart-line"
        role="img"
        aria-label={`Score moyen par mois, de ${min} à ${max} points`}
        onMouseLeave={() => setSurvol(null)}
      >
        {/* Repères horizontaux, volontairement discrets */}
        {[0, 0.5, 1].map((t) => (
          <line
            key={t}
            className="chart-grid"
            x1={30}
            x2={W - 10}
            y1={18 + t * (H - 36)}
            y2={18 + t * (H - 36)}
          />
        ))}

        <path d={trace} className="chart-line-path" />

        {points.map((p) => (
          <g key={p.month}>
            <circle cx={p.x} cy={p.y} r={4.5} className="chart-line-dot" />
            {/* Cible de survol plus large que le point lui-même */}
            <circle
              cx={p.x}
              cy={p.y}
              r={16}
              fill="transparent"
              onMouseEnter={() => setSurvol(p)}
            />
          </g>
        ))}

        {survol && (
          <line
            className="chart-crosshair"
            x1={survol.x}
            x2={survol.x}
            y1={10}
            y2={H - 10}
          />
        )}
      </svg>

      <div className="chart-axis mono small faint">
        <span>{moisCourt(points[0].month)}</span>
        <span>{moisCourt(points[points.length - 1].month)}</span>
      </div>

      <div className="chart-tooltip small">
        {survol ? (
          <>
            <strong>{moisCourt(survol.month)}</strong> · {survol.averageScore} pts de moyenne ·{' '}
            {survol.games} partie{survol.games > 1 ? 's' : ''} · {survol.winRate} % de réussite
          </>
        ) : (
          <span className="faint">Survole un point pour le détail du mois.</span>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 *  Issues des parties — statut, jamais la couleur seule
 * ---------------------------------------------------------------- */

const ISSUES = [
  { cle: 'found', libelle: 'Trouvé', icone: 'trophy', ton: 'ok' },
  { cle: 'surrendered', libelle: 'Abandonné', icone: 'flag', ton: 'warn' },
  { cle: 'exhausted', libelle: 'Tentatives épuisées', icone: 'alert', ton: 'bad' },
];

function Issues({ outcomes, total }) {
  return (
    <div className="outcome-list">
      {ISSUES.map((issue) => {
        const n = outcomes[issue.cle] || 0;
        const part = total ? Math.round((n / total) * 100) : 0;
        return (
          <div key={issue.cle} className={`outcome-row outcome-${issue.ton}`}>
            <span className="outcome-icon">
              <Icon name={issue.icone} size={15} />
            </span>
            <span className="grow">{issue.libelle}</span>
            <span className="mono">{n}</span>
            <span className="mono faint">{part} %</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- *
 *  Le bloc complet
 * ---------------------------------------------------------------- */

export default function DetailedStats() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['stats-detailed'],
    queryFn: async () => (await api.get('/me/stats/detailed')).data,
    retry: false,
  });

  if (isLoading) return <div className="spinner" style={{ margin: '20px auto' }} />;
  if (isError) return null;

  const { totals, distribution, byMonth, outcomes } = data;

  if (!totals.games) {
    return (
      <p className="muted small">
        Joue quelques journées et tes statistiques apparaîtront ici.
      </p>
    );
  }

  return (
    <div className="stack">
      <div className="stat-grid">
        <div className="stat">
          <div className="stat-value">{totals.winRate} %</div>
          <div className="stat-label">Taux de réussite</div>
        </div>
        <div className="stat">
          <div className="stat-value">{totals.averageAttempts ?? '—'}</div>
          <div className="stat-label">Tentatives en moyenne</div>
        </div>
        <div className="stat">
          <div className="stat-value">{duree(totals.averageSeconds)}</div>
          <div className="stat-label">Temps moyen</div>
        </div>
        <div className="stat">
          <div className="stat-value">{totals.averageScore ?? '—'}</div>
          <div className="stat-label">Score moyen</div>
        </div>
      </div>

      <section>
        <h3 className="chart-title">Score moyen par mois</h3>
        <Progression byMonth={byMonth} />
      </section>

      <section>
        <h3 className="chart-title">Parties gagnées, par nombre de tentatives</h3>
        <Repartition distribution={distribution} />
      </section>

      <section>
        <h3 className="chart-title">Comment finissent tes parties</h3>
        <Issues outcomes={outcomes} total={totals.games} />
      </section>
    </div>
  );
}
