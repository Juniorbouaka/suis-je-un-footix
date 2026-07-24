import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

export default function Leaderboard() {
  const [scope, setScope] = useState('all');
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', scope],
    queryFn: async () => (await api.get(`/leaderboard?scope=${scope}`)).data,
  });

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="row row-between wrap" style={{ marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 26 }}>Classement</h1>
          <p className="muted small">Top 100 des joueurs.</p>
        </div>
        <div className="tabs" style={{ width: 240, marginBottom: 0 }}>
          <button className={`tab${scope === 'all' ? ' active' : ''}`} onClick={() => setScope('all')}>
            Général
          </button>
          <button className={`tab${scope === 'today' ? ' active' : ''}`} onClick={() => setScope('today')}>
            Aujourd’hui
          </button>
        </div>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="spinner" />
        ) : !data?.entries?.length ? (
          <p className="muted center" style={{ padding: '26px 0' }}>
            Personne au classement pour l’instant — sois le premier !
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>#</th>
                <th>Joueur</th>
                <th style={{ textAlign: 'right' }}>{scope === 'today' ? 'Score' : 'Points'}</th>
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
                  <td>{e.username}</td>
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

        {data?.me && !data.me.position && (
          <p className="small muted center" style={{ marginTop: 14 }}>
            Tu n’es pas encore classé — termine une partie pour apparaître ici.
          </p>
        )}
      </div>
    </div>
  );
}
