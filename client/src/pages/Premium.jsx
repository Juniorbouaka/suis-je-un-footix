import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Icon from '../components/Icon.jsx';
import { detailPaiement, libellePaiement, portefeuille } from '../lib/paiement.js';

/**
 * L'offre premium.
 *
 * Le cœur de l'offre est le volume de jeu quotidien : quinze chances et un
 * duel en gratuit, cinquante chances et cinq duels avec l'abonnement.
 * Chaque proposition part vers l'API Claude et se paie, alors le volume est
 * devenu ce qui distingue les deux forfaits — c'est le poste de dépense,
 * donc c'est ce qui se vend.
 *
 * Ce que l'abonnement ne donne toujours pas : d'indice, de point offert, ni
 * d'accès à un meilleur évaluateur. Le score reste calculé de la même
 * manière pour tous, et il baisse à chaque tentative supplémentaire. En
 * duel, il ne donne pas non plus un essai de plus : quinze pour tout le
 * monde, sinon ce n'est plus un duel.
 */

const AVANTAGES = [
  {
    icon: 'repeat',
    titre: '5 parties par jour',
    texte:
      'Au lieu d’une. La partie du jour compte au classement, les quatre autres sont des parties d’entraînement : aucun point, aucune médaille, juste du jeu.',
  },
  {
    icon: 'target',
    titre: '50 chances par jour',
    texte: 'Au lieu de 15 : de quoi finir les journées qui résistent.',
  },
  {
    icon: 'swords',
    titre: '5 duels par jour',
    texte: 'Au lieu d’un seul. Revanches comprises, et toujours 15 essais chacun.',
  },
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
    texte:
      'Chaque journée manquée redevient une partie complète — ce sont tes parties d’entraînement.',
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
  // Le libellé du bouton suit le téléphone : « Payer avec Apple Pay » vaut
  // mieux que « Payer par carte » quand on n'aura justement pas de carte à
  // sortir. La page de paiement Stripe affiche le portefeuille en premier.
  const kind = portefeuille();
  const queryClient = useQueryClient();

  /*
   * `isError` est distingué de `!offer.enabled` à dessein. Les deux menaient
   * au même écran « L'abonnement n'est pas encore ouvert », si bien qu'une
   * panne de l'API se lisait comme une décision commerciale : le visiteur
   * repartait convaincu qu'il n'y avait rien à acheter, et rien dans
   * l'interface ne trahissait le problème. C'est exactement ce qui est arrivé.
   */
  const { data: offer, isLoading, isError, refetch, isFetching } = useQuery({
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
      // Une clé refusée retire la carte de l'offre : on la relit pour que le
      // bouton s'efface au profit de PayPal, sans recharger la page.
      queryClient.invalidateQueries({ queryKey: ['billing-offer'] });
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
          et fait passer ta journée d'une à 5 parties, de 15 à 50 chances et d'un à 5 duels, sans
          publicité, archives comprises.
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
        <Icon name="check" size={14} /> Le score, lui, ne s'achète pas : il baisse de 50 points à
        chaque chance utilisée, pour tout le monde. Un abonné qui trouve au 40<sup>e</sup> essai
        marque moins qu'un joueur gratuit qui trouve au 3<sup>e</sup>. Aucun indice, aucun point
        offert — et les quatre parties d'entraînement quotidiennes ne rapportent rien du tout au
        classement, par construction.
      </div>

      {isError ? (
        <div className="card center" style={{ marginTop: 22 }}>
          <Icon name="alert" size={28} />
          <p className="muted" style={{ marginTop: 10 }}>
            Impossible de charger l'offre pour le moment. L'abonnement existe bien — c'est
            l'affichage qui coince.
          </p>
          <button className="btn" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Chargement…' : 'Réessayer'}
          </button>
        </div>
      ) : !offer?.enabled ? (
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
                  <>
                    <button
                      className={`btn btn-lg btn-wallet wallet-${kind || 'card'}${plan.key === 'yearly' ? '' : ' btn-ghost'}`}
                      style={{ width: '100%' }}
                      disabled={isPremium || Boolean(busy)}
                      onClick={() => souscrire(plan.key, 'stripe')}
                    >
                      {busy === `${plan.key}:stripe`
                        ? 'Redirection…'
                        : isPremium
                          ? 'Déjà abonné'
                          : libellePaiement(kind)}
                    </button>
                    {!isPremium && (
                      <p className="small faint center" style={{ margin: 0 }}>
                        {detailPaiement(kind).replace(' — sans créer de compte', '')}
                      </p>
                    )}
                  </>
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
        Carte bancaire, Apple Pay, Google Pay ou PayPal. Résiliable à tout moment depuis ton profil
        — tes avantages courent jusqu'à la fin de la période déjà payée.
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
