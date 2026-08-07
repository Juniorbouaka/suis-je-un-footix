import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { publierCredits, useCredits } from '../lib/credits.js';
import Icon from '../components/Icon.jsx';

/**
 * Les journées passées.
 *
 * Tout est consultable — les fiches sont en cache, les servir ne coûte rien.
 * Ce qui coûte, c'est de PROPOSER : rejouer une journée débite une partie du
 * stock, exactement comme la partie du jour. La règle tient en une phrase, et
 * c'est ce qu'on affiche.
 *
 * Le nom du joueur n'est montré que si le visiteur le connaît déjà — parce
 * qu'il a joué ce jour-là, ou parce qu'il a terminé son rejeu. Sinon la
 * journée reste à jouer : l'afficher la gâcherait.
 */

function formatDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  });
}

function Statut({ day, aSec }) {
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
  // Journée entamée : elle est déjà payée, elle se termine même à zéro.
  if (day.inProgress) return <span className="pill pill-action">en cours</span>;

  if (day.replayable) {
    /*
     * Une journée déjà payée mais pas encore commencée reste ouverte : le
     * débit a eu lieu (un abandon, une reprise), elle ne coûtera rien de
     * plus. Le dire évite qu'un joueur à zéro la croie fermée.
     */
    if (day.paid) {
      return (
        <span className="pill pill-green">
          <Icon name="check" size={12} /> payée
        </span>
      );
    }
    // Plus de stock : annoncer « à jouer » serait promettre une partie que le
    // serveur refusera. On dit ce qu'il en est.
    if (aSec) {
      return (
        <span className="pill faint">
          <Icon name="clock" size={12} /> recharge
        </span>
      );
    }
    return (
      <span className="pill pill-action">
        <Icon name="play" size={12} /> 1 partie
      </span>
    );
  }

  return (
    <span className="pill faint">
      <Icon name="check" size={12} /> jouée
    </span>
  );
}

export default function Archive() {
  const { isPremium, credits: duProfil } = useAuth();
  const credits = useCredits(duProfil);

  const { data, isLoading } = useQuery({
    queryKey: ['archive'],
    queryFn: async () => (await api.get('/archive')).data,
  });

  // Le solde voyage avec la liste : l'en-tête doit bouger en même temps.
  useEffect(() => {
    if (data?.credits) publierCredits(data.credits);
  }, [data]);

  if (isLoading) return <div className="spinner" style={{ marginTop: 80 }} />;

  const days = data?.days || [];
  const aJouer = days.filter((d) => d.replayable && !d.replay).length;
  const solde = credits?.balance ?? 0;
  const aSec = solde <= 0;
  const enCours = days.filter((d) => d.inProgress).length;
  const recharge = credits?.nextRecharge
    ? new Date(credits.nextRecharge).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
    : null;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="row row-between wrap" style={{ marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 26 }}>Archives</h1>
          <p className="muted small">
            {aSec
              ? enCours > 0
                ? `${enCours} partie${enCours > 1 ? 's' : ''} en cours à terminer — elles sont déjà payées.`
                : 'Consulter reste ouvert : c’est rejouer qui demande une partie de ton stock.'
              : aJouer > 0
                ? `${aJouer} journée${aJouer > 1 ? 's' : ''} à rejouer — une partie de ton stock chacune.`
                : 'Les joueurs mystères des jours précédents.'}
          </p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {/* Le solde s'affiche AVANT le clic : ouvrir une journée pour
              apprendre qu'on n'a plus rien serait une petite trahison. */}
          <span className={`pill${!aSec ? ' pill-green' : ''}`}>
            <Icon name="target" size={13} /> {solde} partie{solde > 1 ? 's' : ''} en stock
          </span>
          <span className="pill" title="Le rejeu ne rapporte aucun point">
            <Icon name="repeat" size={13} /> hors classement
          </span>
        </div>
      </div>

      {aSec && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <div className="row row-between wrap" style={{ gap: 10 }}>
            <span>
              Plus de parties en réserve{recharge ? ` — elle se recharge le ${recharge}` : ''}. Les
              journées déjà commencées restent terminables, consulter ne coûte rien, et le joueur
              du jour est compris dans ton abonnement.
            </span>
            <Link to="/premium#recharges" className="btn btn-sm">
              <Icon name="target" size={14} /> Prendre des parties
            </Link>
          </div>
        </div>
      )}

      {days.length === 0 ? (
        <div className="card center">
          <p className="muted">Aucune journée archivée pour l'instant — reviens demain.</p>
        </div>
      ) : (
        <div className="card">
          <div className="stack-sm">
            {days.map((day) => (
              <Link key={day.date} to={`/archives/${day.date}`} className="archive-row">
                <span className="mono faint">n°{day.number}</span>
                <span className="archive-word">{day.word || 'à découvrir'}</span>
                <span className="row" style={{ gap: 8 }}>
                  <span className="mono faint small hide-sm">{formatDate(day.date)}</span>
                  <Statut day={day} aSec={aSec} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
