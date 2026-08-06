import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import SupportWall from '../components/SupportWall.jsx';
import { detailPaiement, libellePaiement, ouvrirDon, portefeuille } from '../lib/paiement.js';

/**
 * Page de soutien.
 *
 * Aucun compte n'est demandé : un visiteur de passage doit pouvoir donner
 * sans s'inscrire. Le montant part vers le serveur, qui le vérifie et ouvre
 * la commande — on ne fait jamais confiance au montant venu du navigateur.
 *
 * L'ordre des moyens de paiement n'est pas neutre. Le premier bouton est le
 * paiement rapide (Apple Pay / Google Pay / carte, via Stripe) : sur
 * téléphone, où se joue l'essentiel du trafic, c'est deux secondes et une
 * empreinte digitale. Saisir seize chiffres au pouce est l'endroit exact où
 * l'on renonce.
 *
 * Le mensonge à ne jamais commettre ici : laisser croire qu'un don donne un
 * avantage dans le jeu. Le texte dit l'inverse, et c'est ce qui rend la
 * demande acceptable.
 */
export default function Support() {
  const [params] = useSearchParams();
  const [choisi, setChoisi] = useState(null);
  const [libre, setLibre] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const kind = portefeuille();
  const queryClient = useQueryClient();

  // Même distinction que sur la page premium : une panne de l'API ne doit pas
  // se lire comme « les dons ne sont pas ouverts ». Voir Premium.jsx.
  const { data: options, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['donate-options'],
    queryFn: async () => (await api.get('/donate/options')).data,
  });

  const { data: stats } = useQuery({
    queryKey: ['donate-stats'],
    queryFn: async () => (await api.get('/donate/stats')).data,
  });

  // `!== false` et non `=== true` : tant que les options n'ont pas été
  // chargées, on préfère afficher un bouton qui marchera à un écran vide.
  const rapide = options?.providers?.stripe !== false;
  const paypal = options?.providers?.paypal !== false;

  const montant = libre.trim() ? Number(libre.replace(',', '.')) : choisi;
  const valide =
    Number.isFinite(montant) &&
    montant >= (options?.min ?? 1) &&
    montant <= (options?.max ?? 500);

  const donner = async (moyen) => {
    if (!valide || busy) return;
    setBusy(moyen);
    setError('');
    try {
      await ouvrirDon(montant, moyen);
    } catch (err) {
      setError(errorMessage(err));
      setBusy('');
      /*
       * Le serveur vient peut-être de constater que sa clé est refusée. On
       * relit les moyens de paiement : le bouton mort disparaît sous les
       * yeux du donateur, au lieu de l'inviter à réessayer pour rien.
       */
      queryClient.invalidateQueries({ queryKey: ['donate-options'] });
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

        {/* Le paiement rapide d'abord : c'est celui qui aboutit sur
            téléphone. PayPal ensuite, pour ceux qui y tiennent — mais s'il
            est le seul disponible, il prend la place du bouton principal :
            un unique moyen de paiement affiché en secondaire ressemble à
            une option qu'on aurait oublié d'activer. */}
        {rapide && (
          <button
            className={`btn btn-lg btn-block btn-wallet wallet-${kind || 'card'}`}
            style={{ marginTop: 18 }}
            disabled={!valide || Boolean(busy) || !options?.enabled}
            onClick={() => donner('stripe')}
          >
            <Icon name={kind ? 'bolt' : 'heart'} size={18} />
            {busy === 'stripe'
              ? 'Redirection…'
              : valide
                ? `${libellePaiement(kind)} · ${montant} €`
                : 'Choisis un montant'}
          </button>
        )}

        {rapide && (
          <p className="small faint center" style={{ marginTop: 8, marginBottom: 0 }}>
            {detailPaiement(kind)}
          </p>
        )}

        {paypal && (
          <button
            className={`btn btn-block${rapide ? ' btn-ghost' : ' btn-lg'}`}
            style={{ marginTop: rapide ? 12 : 18 }}
            disabled={!valide || Boolean(busy) || !options?.enabled}
            onClick={() => donner('paypal')}
          >
            {busy === 'paypal'
              ? 'Redirection…'
              : rapide
                ? 'Payer avec PayPal'
                : valide
                  ? `Payer avec PayPal · ${montant} €`
                  : 'Choisis un montant'}
          </button>
        )}

        {isError ? (
          <div className="center" style={{ marginTop: 14 }}>
            <p className="small muted" style={{ marginBottom: 10 }}>
              Impossible de joindre le service de paiement. Réessaie dans un instant.
            </p>
            <button className="btn btn-sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? 'Chargement…' : 'Réessayer'}
            </button>
          </div>
        ) : (
          !options?.enabled && (
            <p className="small muted center" style={{ marginTop: 12 }}>
              Les dons ne sont pas encore ouverts.
            </p>
          )
        )}

        {error && (
          <div className="alert alert-error" style={{ marginTop: 14 }}>
            {error}
          </div>
        )}

        <p className="small muted center" style={{ marginTop: 16 }}>
          Don ponctuel, sans engagement et sans création de compte.
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
