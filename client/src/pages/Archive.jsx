import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import GuessList from '../components/GuessList.jsx';

/** Les joueurs des jours précédents. Aperçu gratuit, historique complet en premium. */
export default function Archive() {
  const [openDate, setOpenDate] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['archive'],
    queryFn: async () => (await api.get('/archive')).data,
  });

  const open = async (day) => {
    if (day.locked) return;
    if (openDate === day.date) {
      setOpenDate(null);
      return;
    }
    setError('');
    setOpenDate(day.date);
    setDetail(null);
    try {
      const { data: d } = await api.get(`/archive/${day.date}`);
      setDetail(d);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (isLoading) return <div className="spinner" style={{ marginTop: 80 }} />;

  const days = data?.days || [];

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="row row-between wrap" style={{ marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 26 }}>Archives</h1>
          <p className="muted small">Les joueurs mystères des jours précédents.</p>
        </div>
        {data?.isPremium ? (
          <span className="pill pill-green">Premium — accès complet</span>
        ) : (
          <span className="pill">{data?.freeDays} derniers jours en accès libre</span>
        )}
      </div>

      {days.length === 0 ? (
        <div className="card center">
          <p className="muted">Aucune journée archivée pour l’instant — reviens demain.</p>
        </div>
      ) : (
        <div className="card">
          <div className="stack-sm">
            {days.map((day) => (
              <div key={day.date}>
                <button
                  className={`archive-row${day.locked ? ' locked' : ''}${openDate === day.date ? ' open' : ''}`}
                  onClick={() => open(day)}
                  disabled={day.locked}
                >
                  <span className="mono faint">n°{day.number}</span>
                  <span className="archive-word">
                    {day.locked ? '• • • • •' : day.word}
                  </span>
                  <span className="row" style={{ gap: 8 }}>
                    {day.result ? (
                      <span className={`pill ${day.result.outcome === 'found' ? 'pill-green' : ''}`}>
                        {day.result.outcome === 'found'
                          ? `${day.result.attempts} essais · ${day.result.score} pts`
                          : day.result.outcome === 'exhausted'
                            ? 'échoué'
                            : 'abandonné'}
                      </span>
                    ) : (
                      <span className="pill faint">non joué</span>
                    )}
                    {day.locked && <Icon name="alert" size={15} />}
                  </span>
                </button>

                {openDate === day.date && (
                  <div className="archive-detail">
                    {!detail ? (
                      <div className="spinner" style={{ width: 26, height: 26 }} />
                    ) : (
                      <>
                        <div className="bio">
                          <span className="bio-label">{detail.word}</span>
                          {detail.description}
                        </div>
                        {detail.guesses?.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <h3 style={{ fontSize: 14, marginBottom: 8 }}>
                              Tes {detail.guesses.length} propositions
                            </h3>
                            <GuessList guesses={detail.guesses} sort="best" />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {!data?.isPremium && days.some((d) => d.locked) && (
            <div className="alert alert-info" style={{ marginTop: 16 }}>
              Les journées plus anciennes sont réservées aux comptes premium.
            </div>
          )}

          {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
