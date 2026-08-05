import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Icon from '../components/Icon.jsx';

/**
 * L'offre premium.
 *
 * Ce qui se vend ici est du confort et du contenu — jamais un avantage de
 * jeu. Pas de tentative supplémentaire, pas d'indice : sur un jeu quotidien
 * avec classement, un premium qui aide à gagner viderait le classement de
 * son sens en quelques semaines.
 */

const AVANTAGES = [
  {
    icon: 'flag',
    titre: 'Aucune publicité',
    texte: 'Le jeu, rien que le jeu, sur toutes les pages.',
  },
  {
    icon: 'book',
    titre: 'Toutes les archives',
    texte: 'Les journées passées en accès libre, au lieu des trois dernières.',
  },
  {
    icon: 'play',
    titre: 'Rejouer les journées passées',
    texte: 'Chaque journée que tu as manquée redevient une partie complète.',
  },
  {
    icon: 'chart',
    titre: 'Statistiques détaillées',
    texte: 'Ta progression mois par mois, la répartition de tes tentatives, ton historique complet.',
  },
  {
    icon: 'palette',
    titre: 'Thèmes de terrain',
    texte: 'Quatre décors supplémentaires : nocturne, braise, glace, terre battue.',
  },
  {
    icon: 'crown',
    titre: 'Badge au classement',
    texte: 'Une couronne à côté de ton pseudo, au classement et en duel.',
  },
];

export default function Premium() {
  const { isAuthenticated, isPremium } = useAuth();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const { data: offer, isLoading } = useQuery({
    queryKey: ['billing-offer'],
    queryFn: async () => (await api.get('/billing/offer')).data,
  });

  /**
   * Ouvre le paiement chez l'encaisseur choisi.
   * Les deux repartent avec la même mécanique : le serveur crée la session,
   * on quitte le site, et le webhook fait foi au retour.
   */
  const souscrire = async (planKey, moyen) => {
    setBusy(`${planKey}:${moyen}`);
    setError('');
    try {
      if (moyen === 'stripe') {
        const { data } = await api.post('/stripe/subscribe', { plan: planKey });
        window.location.href = data.url;
      } else {
        const { data } = await api.post('/billing/subscribe', { plan: planKey });
        window.location.href = data.approveUrl;
      }
    } catch (err) {
      setError(errorMessage(err));
      setBusy('');
    }
  };

  if (isLoading) return <div className="spinner" style={{ marginTop: 80 }} />;

  const annule = params.get('annule');

  return (
    <div style={{ maxWidth: 780, margin: '0 auto' }}>
      <div className="center" style={{ marginBottom: 26 }}>
        <span className="pill pill-green">
          <Icon name="crown" size={14} /> Premium
        </span>
        <h1 style={{ fontSize: 30, margin: '14px 0 8px' }}>Soutiens le jeu, débloque tout</h1>
        <p className="muted" style={{ maxWidth: 520, margin: '0 auto' }}>
          Chaque proposition est évaluée par une IA, et ça se paye. L'abonnement fait vivre le jeu —
          et t'ouvre les archives, les statistiques et les thèmes.
        </p>
      </div>

      {annule && (
        <div className="alert alert-info" style={{ marginBottom: 18 }}>
          Paiement annulé. Rien n'a été prélevé.
        </div>
      )}

      {isPremium && (
        <div className="alert alert-success" style={{ marginBottom: 18 }}>
          Tu es déjà abonné — merci. Tu peux gérer ton abonnement depuis{' '}
          <Link to="/profil">ton profil</Link>.
        </div>
      )}

      <div className="premium-grid">
        {AVANTAGES.map((a) => (
          <div key={a.titre} className="premium-feature">
            <span className="premium-feature-icon">
              <Icon name={a.icon} size={19} />
            </span>
            <div>
              <div className="premium-feature-title">{a.titre}</div>
              <p className="small muted" style={{ margin: '3px 0 0' }}>
                {a.texte}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="premium-note small muted">
        <Icon name="check" size={14} /> Le classement reste au mérite : l'abonnement ne donne
        aucune tentative en plus, aucun indice, aucun point. C'est un choix, pas un oubli.
      </div>

      {!offer?.enabled ? (
        <div className="card center" style={{ marginTop: 22 }}>
          <p className="muted">
            L'abonnement n'est pas encore ouvert. Reviens bientôt !
          </p>
        </div>
      ) : !isAuthenticated ? (
        <div className="card center" style={{ marginTop: 22 }}>
          <p className="muted">Crée un compte pour t'abonner — c'est gratuit et ça prend 30 secondes.</p>
        </div>
      ) : (
        <div className="plan-grid" style={{ marginTop: 22 }}>
          {(offer?.plans || []).map((plan) => (
            <div key={plan.key} className={`card plan${plan.key === 'yearly' ? ' plan-best' : ''}`}>
              {plan.key === 'yearly' && <span className="plan-flag">2 mois offerts</span>}
              <div className="plan-label">{plan.label}</div>
              <div className="plan-price">
                {plan.price} <span className="plan-currency">€</span>
              </div>
              <div className="plan-period muted small">{plan.period}</div>

              <div className="stack-sm" style={{ marginTop: 16 }}>
                {plan.stripe && (
                  <button
                    className={`btn btn-lg${plan.key === 'yearly' ? '' : ' btn-ghost'}`}
                    style={{ width: '100%' }}
                    disabled={isPremium || Boolean(busy)}
                    onClick={() => souscrire(plan.key, 'stripe')}
                  >
                    {busy === `${plan.key}:stripe`
                      ? 'Redirection…'
                      : isPremium
                        ? 'Déjà abonné'
                        : 'Payer par carte'}
                  </button>
                )}

                {plan.paypal && (
                  <button
                    className={`btn btn-lg${plan.key === 'yearly' && !plan.stripe ? '' : ' btn-ghost'}`}
                    style={{ width: '100%' }}
                    disabled={isPremium || Boolean(busy)}
                    onClick={() => souscrire(plan.key, 'paypal')}
                  >
                    {busy === `${plan.key}:paypal`
                      ? 'Redirection…'
                      : isPremium
                        ? 'Déjà abonné'
                        : 'Payer avec PayPal'}
                  </button>
                )}

                {!plan.available && (
                  <p className="small faint center" style={{ margin: 0 }}>
                    Indisponible
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}

      <p className="small muted center" style={{ marginTop: 20 }}>
        Paiement par PayPal. Résiliable à tout moment depuis ton profil — tes avantages courent
        jusqu'à la fin de la période déjà payée.
      </p>

      {offer?.donateUrl && (
        <p className="small muted center" style={{ marginTop: 10 }}>
          Tu préfères un coup de pouce ponctuel ?{' '}
          <a href={offer.donateUrl} target="_blank" rel="noreferrer noopener">
            Offrir un café <Icon name="heart" size={12} />
          </a>
        </p>
      )}
    </div>
  );
}
