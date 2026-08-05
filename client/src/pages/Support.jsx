import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import SupportWall from '../components/SupportWall.jsx';

/**
 * Page de soutien.
 *
 * Aucun compte n'est demandé : un visiteur de passage doit pouvoir donner
 * sans s'inscrire. Le montant part vers le serveur, qui le vérifie et ouvre
 * la commande — on ne fait jamais confiance au montant venu du navigateur.
 *
 * Le mensonge à ne jamais commettre ici : laisser croire qu'un don donne un
 * avantage dans le jeu. Le texte dit l'inverse, et c'est ce qui rend la
 * demande acceptable.
 */
export default function Support() {
  const [params] = useSearchParams();
  const [choisi, setChoisi] = useState(null);
  const [libre, setLibre] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { data: options, isLoading } = useQuery({
    queryKey: ['donate-options'],
    queryFn: async () => (await api.get('/donate/options')).data,
  });

  const { data: stats } = useQuery({
    queryKey: ['donate-stats'],
    queryFn: async () => (await api.get('/donate/stats')).data,
  });

  const montant = libre.trim() ? Number(libre.replace(',', '.')) : choisi;
  const valide =
    Number.isFinite(montant) &&
    montant >= (options?.min ?? 1) &&
    montant <= (options?.max ?? 500);

  const donner = async () => {
    if (!valide || busy) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/donate', { amount: montant });
      window.location.href = data.approveUrl;
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (isLoading) return <div className="spinner" style={{ marginTop: 80 }} />;

  return (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>
      <div className="center" style={{ marginBottom: 24 }}>
        <span className="don-hero-icon">
          <Icon name="heart" size={32} strokeWidth={1.6} />
        </span>
        <h1 style={{ fontSize: 28, margin: '14px 0 8px' }}>Soutenir le jeu</h1>
        <p className="muted" style={{ maxWidth: 460, margin: '0 auto' }}>
          Chaque proposition que tu envoies est évaluée par une IA, et chaque évaluation coûte
          quelques centimes. Un don paye ces calculs et l'hébergement — rien d'autre.
        </p>
      </div>

      {params.get('annule') && (
        <div className="alert alert-info" style={{ marginBottom: 18 }}>
          Paiement annulé. Rien n'a été prélevé.
        </div>
      )}

      <div className="card">
        <div className="don-grid">
          {(options?.amounts || []).map((m) => (
            <button
              key={m}
              className={`don-choix${choisi === m && !libre.trim() ? ' active' : ''}`}
              onClick={() => {
                setChoisi(m);
                setLibre('');
              }}
            >
              {m} €
            </button>
          ))}
        </div>

        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="libre">Ou le montant de ton choix</label>
          <div className="don-libre">
            <input
              id="libre"
              className="input"
              type="text"
              inputMode="decimal"
              placeholder={`entre ${options?.min ?? 1} et ${options?.max ?? 500}`}
              value={libre}
              onChange={(e) => setLibre(e.target.value)}
            />
            <span className="don-devise">€</span>
          </div>
        </div>

        <button
          className="btn btn-lg"
          style={{ width: '100%', marginTop: 18 }}
          disabled={!valide || busy || !options?.enabled}
          onClick={donner}
        >
          {busy
            ? 'Redirection…'
            : valide
              ? `Donner ${montant} €`
              : 'Choisis un montant'}
        </button>

        {!options?.enabled && (
          <p className="small muted center" style={{ marginTop: 12 }}>
            Les dons ne sont pas encore ouverts.
          </p>
        )}

        {error && (
          <div className="alert alert-error" style={{ marginTop: 14 }}>
            {error}
          </div>
        )}

        <p className="small muted center" style={{ marginTop: 16 }}>
          Paiement par PayPal ou carte bancaire, sans créer de compte. Don ponctuel, sans
          engagement.
        </p>
      </div>

      <div className="don-note small muted">
        <Icon name="check" size={14} />
        <span>
          Un don ne donne <strong>aucun avantage</strong> dans le jeu : ni tentative
          supplémentaire, ni indice, ni point au classement. Si tu veux débloquer les archives
          et les statistiques, c'est <Link to="/premium">l'abonnement premium</Link> qu'il te
          faut — mais le jeu reste entièrement jouable sans rien payer.
        </span>
      </div>

      <SupportWall />

      {stats?.supporters > 0 && (
        <p className="small muted center" style={{ marginTop: 16 }}>
          {stats.supporters} personne{stats.supporters > 1 ? 's ont' : ' a'} déjà soutenu le jeu.
          Merci à {stats.supporters > 1 ? 'elles' : 'elle'}.
        </p>
      )}
    </div>
  );
}
