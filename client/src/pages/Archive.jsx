import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';

/**
 * Les journées passées.
 *
 * Le nom n'est affiché que si le joueur le connaît déjà — parce qu'il a joué
 * ce jour-là, ou parce qu'il a terminé son rejeu. Sinon la journée reste à
 * jouer : l'afficher la gâcherait.
 */

function formatDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  });
}

function Statut({ day, quotaEpuise }) {
  if (day.locked) {
    return (
      <span className="pill faint">
        <Icon name="lock" size={12} /> premium
      </span>
    );
  }
  if (day.result) {
    return (
      <span className={`pill ${day.result.outcome === 'found' ? 'pill-green' : ''}`}>
        {day.result.outcome === 'found'
          ? `${day.result.attempts} essais · ${day.result.score} pts`
          : day.result.outcome === 'exhausted'
            ? 'échoué'
            : 'abandonné'}
      </span>
    );
  }
  if (day.replay) {
    return (
      <span className={`pill ${day.replay.outcome === 'found' ? 'pill-green' : ''}`}>
        rejoué · {day.replay.attempts} essais
      </span>
    );
  }
  if (day.inProgress) return <span className="pill">en cours</span>;
  if (day.replayable) {
    // Plus de crédit d'entraînement : annoncer « à jouer » serait promettre
    // une partie que le serveur refusera. On dit quand elle rouvre.
    if (quotaEpuise) {
      return (
        <span className="pill faint">
          <Icon name="clock" size={12} /> demain
        </span>
      );
    }
    return (
      <span className="pill pill-action">
        <Icon name="play" size={12} /> à jouer
      </span>
    );
  }
  // Consultable mais pas jouable : le rejeu est reserve aux abonnes.
  return (
    <span className="pill faint">
      <Icon name="crown" size={12} /> rejeu premium
    </span>
  );
}

export default function Archive() {
  const { data, isLoading } = useQuery({
    queryKey: ['archive'],
    queryFn: async () => (await api.get('/archive')).data,
  });

  if (isLoading) return <div className="spinner" style={{ marginTop: 80 }} />;

  const days = data?.days || [];
  const aJouer = days.filter((d) => !d.locked && d.replayable && !d.replay).length;
  const training = data?.training;
  const restantes = training?.remaining ?? 0;
  const quotaEpuise = Boolean(data?.isPremium && training?.max > 0 && restantes === 0);
  const enCours = days.filter((d) => d.inProgress).length;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="row row-between wrap" style={{ marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 26 }}>Archives</h1>
          <p className="muted small">
            {quotaEpuise
              ? enCours > 0
                ? `${enCours} partie${enCours > 1 ? 's' : ''} en cours à terminer — les autres rouvrent à minuit.`
                : 'Tes parties d’entraînement rouvrent à minuit.'
              : aJouer > 0
                ? `${aJouer} journée${aJouer > 1 ? 's' : ''} que tu peux encore jouer.`
                : 'Les joueurs mystères des jours précédents.'}
          </p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {/* Le quota s'affiche AVANT le clic : ouvrir une journée pour
              apprendre qu'on n'a plus de crédit serait une petite trahison. */}
          {data?.isPremium && training?.max > 0 && (
            <span className={`pill${restantes > 0 ? ' pill-green' : ''}`}>
              <Icon name="repeat" size={13} /> {restantes}/{training.max} entraînement
            </span>
          )}
          {data?.isPremium ? (
            <span className="pill pill-green">
              <Icon name="crown" size={13} /> Accès complet
            </span>
          ) : (
            <span className="pill">{data?.freeDays} derniers jours en accès libre</span>
          )}
        </div>
      </div>

      {data?.isPremium && restantes === 0 && training?.max > 0 && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          Tes {training.max} parties d'entraînement du jour sont utilisées — les journées déjà
          commencées restent terminables. Tout se remet à zéro à minuit.
        </div>
      )}

      {days.length === 0 ? (
        <div className="card center">
          <p className="muted">Aucune journée archivée pour l'instant — reviens demain.</p>
        </div>
      ) : (
        <div className="card">
          <div className="stack-sm">
            {days.map((day) => {
              const contenu = (
                <>
                  <span className="mono faint">n°{day.number}</span>
                  <span className="archive-word">
                    {day.word || (day.locked ? '• • • • •' : 'à découvrir')}
                  </span>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="mono faint small hide-sm">{formatDate(day.date)}</span>
                    <Statut day={day} quotaEpuise={quotaEpuise} />
                  </span>
                </>
              );

              // Une journée verrouillée n'est pas cliquable ; une journée
              // accessible mène toujours à sa page, jouable ou déjà résolue.
              return day.locked ? (
                <div key={day.date} className="archive-row locked">
                  {contenu}
                </div>
              ) : (
                <Link key={day.date} to={`/archives/${day.date}`} className="archive-row">
                  {contenu}
                </Link>
              );
            })}
          </div>

          {!data?.isPremium && days.some((d) => d.locked) && (
            <div className="alert alert-info" style={{ marginTop: 16 }}>
              <div className="row row-between wrap" style={{ gap: 10 }}>
                <span>
                  Les journées plus anciennes sont réservées aux abonnés, qui peuvent aussi
                  <strong> rejouer</strong> toutes celles qu'ils ont manquées.
                </span>
                <Link to="/premium" className="btn btn-sm">
                  <Icon name="crown" size={14} /> Débloquer
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
