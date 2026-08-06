import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Icon from '../components/Icon.jsx';
import PremiumBadge from '../components/PremiumBadge.jsx';
import SupporterBadge from '../components/SupporterBadge.jsx';

/**
 * Le classement, en trois onglets.
 *
 * « Le mois » est la course ouverte : elle repart de zéro tous les mois, ce
 * qui laisse une chance à un joueur arrivé en mars. « Général » est le cumul
 * de toujours, la carrière. « Palmarès » garde les vainqueurs des mois
 * terminés — un titre gagné ne se reperd pas au classement suivant.
 */

const ONGLETS = [
  { key: 'month', label: 'Le mois' },
  { key: 'all', label: 'Général' },
  { key: 'hall', label: 'Palmarès' },
];

/** « 2026-08 » → « août 2026 ». */
function moisEnLettres(month) {
  if (!month) return '';
  const [y, m] = month.split('-');
  const texte = new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return texte;
}

function NomJoueur({ entry }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      {entry.username}
      {entry.isPremium && <PremiumBadge size={12} />}
      {entry.isSupporter && <SupporterBadge size={11} />}
    </span>
  );
}

export default function Leaderboard() {
  const [scope, setScope] = useState('month');
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', scope],
    queryFn: async () => (await api.get(`/leaderboard?scope=${scope}`)).data,
  });

  const sousTitre = {
    month: `Les points marqués en ${moisEnLettres(data?.month)}. Remise à zéro le 1er du mois.`,
    all: 'Le cumul de toutes les journées, depuis le premier jour.',
    hall: 'Les vainqueurs des mois terminés. Un mois scellé ne change plus.',
  }[scope];

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="row row-between wrap" style={{ marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 26 }}>Classement</h1>
          <p className="muted small">{sousTitre}</p>
        </div>
        <div className="tabs" style={{ width: 300, marginBottom: 0 }}>
          {ONGLETS.map((o) => (
            <button
              key={o.key}
              className={`tab${scope === o.key ? ' active' : ''}`}
              onClick={() => setScope(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="spinner" />
        ) : scope === 'hall' ? (
          !data?.champions?.length ? (
            <p className="muted center" style={{ padding: '26px 0' }}>
              Aucun mois terminé pour l’instant. Le premier titre se joue en ce moment.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 130 }}>Mois</th>
                  <th>Vainqueur</th>
                  <th style={{ textAlign: 'right' }}>Points</th>
                  <th style={{ textAlign: 'right', width: 90 }}>Parties</th>
                </tr>
              </thead>
              <tbody>
                {data.champions.map((c) => (
                  <tr key={c.month} className={c.userId === user?.id ? 'is-me' : ''}>
                    <td className="small muted">{moisEnLettres(c.month)}</td>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        <Icon name="trophy" size={14} />
                        <NomJoueur entry={c} />
                      </span>
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>
                      {c.total}
                    </td>
                    <td className="mono faint" style={{ textAlign: 'right' }}>
                      {c.days}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : !data?.entries?.length ? (
          <p className="muted center" style={{ padding: '26px 0' }}>
            {scope === 'month'
              ? 'Personne n’a encore marqué ce mois-ci — la place est libre !'
              : 'Personne au classement pour l’instant — sois le premier !'}
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>#</th>
                <th>Joueur</th>
                <th style={{ textAlign: 'right' }}>Points</th>
                <th style={{ textAlign: 'right', width: 90 }}>Parties</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.userId} className={e.userId === user?.id ? 'is-me' : ''}>
                  <td>
                    <span className={`rank mono${e.position <= 3 ? ` rank-${e.position}` : ''}`}>
                      {e.position}
                    </span>
                  </td>
                  <td>
                    <NomJoueur entry={e} />
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {e.total}
                  </td>
                  <td className="mono faint" style={{ textAlign: 'right' }}>
                    {e.days}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {scope !== 'hall' && data?.me && !data.me.position && (
          <p className="small muted center" style={{ marginTop: 14 }}>
            {scope === 'month'
              ? 'Tu n’as pas encore marqué ce mois-ci — une partie gagnée suffit à entrer.'
              : 'Tu n’es pas encore classé — termine une partie pour apparaître ici.'}
          </p>
        )}
      </div>
    </div>
  );
}
