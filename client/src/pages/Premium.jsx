import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Icon from '../components/Icon.jsx';
import { detailPaiement, libellePaiement, portefeuille } from '../lib/paiement.js';

/**
 * L'offre.
 *
 * Le jeu est payant à l'entrée. Ce n'est pas un détail d'affichage, c'est ce
 * que la page doit dire en premier : le visiteur qui arrive ici a cliqué sur
 * « Jouer », et lui laisser croire à un essai gratuit pour le heurter au mur
 * trois écrans plus loin serait pire que de le lui dire tout de suite.
 *
 * Deux forfaits, et un seul chiffre les sépare vraiment : le nombre de
 * parties. C'est aussi le seul poste de dépense du jeu — chaque proposition
 * part vers l'API Claude et se facture. On vend donc exactement ce qu'on
 * achète, ce qui a le mérite de s'expliquer en une phrase.
 *
 * Ce que l'abonnement ne donne toujours pas : d'indice, de point offert, ni
 * d'évaluateur plus complaisant. Le score se calcule pareil pour tout le
 * monde et il baisse à chaque tentative. En duel, quinze essais chacun,
 * abonné ou non — sinon ce n'est plus un duel. Et une seule partie classée
 * par jour : payer achète du temps de jeu, jamais des points.
 */

/* Ce que chaque forfait ouvre. `credits` est rempli par le serveur. */
const DETAIL_FORMULES = {
  access: {
    argument: 'Le rendez-vous quotidien, plus de quoi rejouer deux ou trois fois par semaine.',
    avantages: [
      'Les duels, en aléatoire comme sur invitation',
      'Toutes les archives, et le droit de les rejouer',
      'Parties supplémentaires rechargées chaque mois',
    ],
    manque: ['Publicité affichée', 'Thèmes de terrain et statistiques détaillées réservés'],
  },
  unlimited: {
    argument: 'Pour enchaîner : archives et duels tous les jours, sans compter.',
    avantages: [
      'Cinq fois plus de parties supplémentaires',
      'Aucune publicité, nulle part',
      'Statistiques détaillées et historique complet',
      'Quatre thèmes de terrain supplémentaires',
      'Couronne à côté de ton pseudo, au classement et en duel',
    ],
    manque: [],
  },
};

/* Ce qui vaut pour les deux, et qui répond à « qu'est-ce que je paie ? ». */
const COMMUN = [
  {
    icon: 'clock',
    titre: 'Le joueur du jour, tous les jours',
    texte:
      'Compris dans les deux formules, sans rien décompter. C’est le rendez-vous du jeu : il ne se paie pas à l’unité.',
  },
  {
    icon: 'target',
    titre: '20 chances par partie',
    texte:
      'Pour tout le monde, quelle que soit la formule. Ce qu’on achète, c’est le nombre de parties — jamais un avantage à l’intérieur d’une partie.',
  },
  {
    icon: 'swords',
    titre: 'Duels et archives à volonté',
    texte:
      'Dans la limite de tes parties supplémentaires : un duel ou une journée d’archive en coûte une. Sur invitation, l’hôte paie pour deux — tu peux faire jouer un ami qui n’a plus rien.',
  },
  {
    icon: 'chart',
    titre: 'Le classement reste le classement',
    texte:
      'Une seule partie compte par jour, la première. Les suivantes se jouent hors classement : l’abonnement achète du temps de jeu, pas des points.',
  },
];

export default function Premium() {
  const { isAuthenticated, hasAccess, isPremium, plan: planActuel, refreshProfile } = useAuth();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
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
   *
   * Trois issues, et le code doit les distinguer :
   *
   *   — souscription : on quitte le site vers la page de paiement, le
   *     webhook fait foi au retour ;
   *   — changement de formule chez Stripe : rien à approuver, l'abonnement
   *     est modifié sur place et le nouveau stock est déjà servi. On reste
   *     sur la page et on le dit ;
   *   — changement de formule chez PayPal : le payeur doit approuver la
   *     hausse, donc on repart comme pour une souscription.
   */
  const souscrire = async (planKey, moyen) => {
    setBusy(`${planKey}:${moyen}`);
    setError('');
    setMessage('');
    try {
      const route = moyen === 'stripe' ? '/stripe/subscribe' : '/billing/subscribe';
      const { data } = await api.post(route, { plan: planKey });

      const url = data.url || data.approveUrl;
      if (url) {
        window.location.href = url;
        return;
      }

      // Changement appliqué sur place : le solde a bougé, le profil aussi.
      await refreshProfile();
      queryClient.invalidateQueries({ queryKey: ['billing-credits'] });
      setMessage('Formule changée — ton nouveau stock de parties est déjà crédité.');
      setBusy('');
    } catch (err) {
      setError(errorMessage(err));
      setBusy('');
      // Une clé refusée retire la carte de l'offre : on la relit pour que le
      // bouton s'efface au profit de PayPal, sans recharger la page.
      queryClient.invalidateQueries({ queryKey: ['billing-offer'] });
    }
  };

  /**
   * Achète une recharge de parties.
   *
   * Paiement ponctuel : on quitte le site vers Stripe, et c'est le webhook
   * qui crédite au retour. Rien n'est ajouté ici — le navigateur ne décide
   * pas de ce qui atterrit sur un compte.
   */
  const acheterRecharge = async (packKey) => {
    setBusy(`pack:${packKey}`);
    setError('');
    setMessage('');
    try {
      const { data } = await api.post('/stripe/credits', { pack: packKey });
      window.location.href = data.url;
    } catch (err) {
      setError(errorMessage(err));
      setBusy('');
    }
  };

  if (isLoading) return <div className="spinner" style={{ marginTop: 80 }} />;

  const annule = params.get('annule');
  // Renvoyé ici par le mur de paiement : il a cliqué sur « Jouer ».
  const requis = params.get('requis');
  /*
   * Renvoyé ici par l'essai épuisé — et ce n'est pas la même personne.
   *
   * Celui qui arrive avec `requis` n'a pas encore joué : il faut lui
   * expliquer pourquoi le jeu se paie. Celui qui arrive avec `essai=epuise`
   * vient de jouer huit coups, il sait déjà ce qu'il achète et il a une
   * partie en cours. Lui resservir l'explication, c'est le faire attendre
   * devant la caisse.
   */
  const essaiEpuise = params.get('essai') === 'epuise';

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div className="center" style={{ marginBottom: 26 }}>
        <span className="pill pill-green">
          <Icon name="crown" size={14} /> Abonnement
        </span>
        <h1 style={{ fontSize: 30, margin: '14px 0 8px' }}>Choisis ta formule</h1>
        <p className="muted" style={{ maxWidth: 560, margin: '0 auto' }}>
          Chaque mot que tu proposes est évalué par une IA, et chaque évaluation se paie. Le jeu
          fonctionne donc à l'abonnement. Les deux formules donnent le joueur mystère du jour,
          tous les jours — ce qui les sépare, c'est le nombre de parties en plus : archives à
          rejouer et duels.
        </p>
      </div>

      {essaiEpuise ? (
        <div className="alert alert-info" style={{ marginBottom: 18 }}>
          <strong>Ton essai est terminé.</strong> Ta partie du jour, elle, reste ouverte : choisis
          une formule et tu la reprends là où tu l'as laissée.
        </div>
      ) : (
        requis && (
          <div className="alert alert-info" style={{ marginBottom: 18 }}>
            Jouer demande un abonnement. C'est le prix des évaluations : sans lui, le jeu s'arrête.
          </div>
        )
      )}

      {annule && (
        <div className="alert alert-info" style={{ marginBottom: 18 }}>
          Paiement annulé. Rien n'a été prélevé.
        </div>
      )}

      {message && (
        <div className="alert alert-success" style={{ marginBottom: 18 }}>
          {message} <Link to="/solo">Jouer maintenant</Link>.
        </div>
      )}

      {isError ? (
        <div className="card center" style={{ marginBottom: 22 }}>
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
        <div className="card center" style={{ marginBottom: 22 }}>
          <p className="muted">L'abonnement n'est pas encore ouvert. Reviens bientôt !</p>
        </div>
      ) : !isAuthenticated ? (
        <div className="card center" style={{ marginBottom: 22 }}>
          {/* Ce que voit un visiteur venu lire les prix avant d'avoir joué.
              Lui parler d'abonnement d'abord, c'est lui demander de décider
              sans rien savoir : l'essai passe devant, et il est la seule
              raison pour laquelle créer un compte a un intérêt immédiat. */}
          <p className="muted">
            Crée un compte et joue tes{' '}
            <strong>{offer?.trialGuesses ?? 8} chances offertes</strong> avant de décider —
            c'est gratuit, sans carte bancaire, et ça prend 30 secondes.
          </p>
        </div>
      ) : (
        <div className="plan-grid" style={{ marginBottom: 22 }}>
          {(offer?.plans || []).map((plan) => {
            const detail = DETAIL_FORMULES[plan.key] || { avantages: [], manque: [] };
            const meilleur = plan.key === 'unlimited';
            const actuel = hasAccess && planActuel === plan.key;

            return (
              <div key={plan.key} className={`card plan${meilleur ? ' plan-best' : ''}`}>
                {meilleur && <span className="plan-flag">Le plus joué</span>}
                <div className="plan-label">{plan.label}</div>
                <div className="plan-price">
                  {plan.price} <span className="plan-currency">€</span>
                </div>
                <div className="plan-period muted small">{plan.period}</div>

                {/* Ce qui est acquis dans les deux cas vient EN PREMIER :
                    c'est la promesse principale, et la placer sous le prix
                    évite qu'on croie payer uniquement des suppléments. */}
                <div className="plan-included">
                  <Icon name="check" size={14} /> Le joueur du jour, tous les jours
                </div>

                {/* Le chiffre qui décide entre les deux cartes. Il est plus
                    gros que le reste parce que c'est lui qu'on compare. */}
                <div className="plan-credits">
                  <strong className="mono">+{plan.credits}</strong> parties par mois
                </div>
                <p className="small muted" style={{ margin: '4px 0 0' }}>
                  {detail.argument}
                </p>

                <ul className="plan-list">
                  {detail.avantages.map((a) => (
                    <li key={a}>
                      <Icon name="check" size={14} /> {a}
                    </li>
                  ))}
                  {detail.manque.map((m) => (
                    <li key={m} className="faint">
                      <Icon name="lock" size={14} /> {m}
                    </li>
                  ))}
                </ul>

                <div className="stack-sm" style={{ marginTop: 16 }}>
                  {actuel ? (
                    <div className="alert alert-success" style={{ margin: 0 }}>
                      C'est ta formule actuelle.
                    </div>
                  ) : (
                    <>
                      {plan.stripe && (
                        <>
                          <button
                            className={`btn btn-lg btn-wallet wallet-${kind || 'card'}${meilleur ? '' : ' btn-ghost'}`}
                            style={{ width: '100%' }}
                            disabled={Boolean(busy)}
                            onClick={() => souscrire(plan.key, 'stripe')}
                          >
                            {busy === `${plan.key}:stripe`
                              ? 'Un instant…'
                              : hasAccess
                                ? `Passer à ${plan.label}`
                                : libellePaiement(kind)}
                          </button>
                          {!hasAccess && (
                            <p className="small faint center" style={{ margin: 0 }}>
                              {detailPaiement(kind).replace(' — sans créer de compte', '')}
                            </p>
                          )}
                        </>
                      )}

                      {plan.paypal && (
                        <button
                          className={`btn btn-lg${meilleur && !plan.stripe ? '' : ' btn-ghost'}`}
                          style={{ width: '100%' }}
                          disabled={Boolean(busy)}
                          onClick={() => souscrire(plan.key, 'paypal')}
                        >
                          {busy === `${plan.key}:paypal` ? 'Un instant…' : 'Payer avec PayPal'}
                        </button>
                      )}

                      {!plan.available && (
                        <p className="small faint center" style={{ margin: 0 }}>
                          Indisponible
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 18 }}>
          {error}
        </div>
      )}

      {/*
        Les recharges — pour qui a déjà un abonnement et a vidé sa réserve.
        Elles ne s'affichent qu'aux abonnés : vendre des parties à quelqu'un
        qui ne peut pas encore jouer serait lui vendre l'inutilisable, et le
        serveur les refuserait de toute façon.
      */}
      {hasAccess && (offer?.packs || []).length > 0 && (
        <section id="recharges" className="card" style={{ marginBottom: 22 }}>
          <h2 style={{ fontSize: 18, marginBottom: 4 }}>
            <Icon name="target" size={16} /> Prendre des parties à l'unité
          </h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Sans engagement, et <strong>elles ne périment pas</strong> : ce que tu n'auras pas joué
            ce mois-ci reste sur ton compte le mois suivant. Le joueur du jour, lui, reste compris
            dans ton abonnement — ces parties servent aux archives et aux duels.
          </p>

          <div className="pack-grid">
            {offer.packs.map((pack) => (
              <button
                key={pack.key}
                className="pack"
                disabled={Boolean(busy)}
                onClick={() => acheterRecharge(pack.key)}
              >
                <span className="pack-credits mono">{pack.credits}</span>
                <span className="pack-label">parties</span>
                <span className="pack-price">
                  {busy === `pack:${pack.key}` ? 'Un instant…' : `${pack.price} €`}
                </span>
              </button>
            ))}
          </div>

          {/*
            Le dire nous-mêmes plutôt que de le laisser découvrir : à l'unité,
            la partie coûte deux fois le prix du forfait. Quelqu'un qui empile
            les recharges tous les mois se fait avoir en silence, et il finit
            par s'en apercevoir — ce jour-là il ne se réabonne pas.
          */}
          {!isPremium && (
            <p className="small muted" style={{ marginBottom: 0 }}>
              <Icon name="alert" size={13} /> Si ça t'arrive tous les mois, l'Illimité revient moins
              cher : 100 parties pour 9,99 € au lieu de 75 à l'unité pour le même prix.
            </p>
          )}
        </section>
      )}

      {/* Ce qui vaut pour les deux formules : on l'affiche APRÈS les prix.
          Le visiteur vient chercher un tarif, pas une liste d'arguments. */}
      <div className="premium-grid">
        {COMMUN.map((a) => (
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
        <Icon name="check" size={14} /> Une partie entamée n'est jamais décomptée deux fois : on
        débite à l'ouverture, et reprendre après une déconnexion ne coûte rien. Si l'évaluateur
        tombe en panne ou si un duel ne démarre pas, la partie est rendue — le détail de chaque
        mouvement est lisible dans ton profil.
      </div>

      <p className="small muted center" style={{ marginTop: 20 }}>
        Carte bancaire, Apple Pay, Google Pay ou PayPal. Résiliable à tout moment depuis ton profil
        — ton stock reste utilisable jusqu'à la fin de la période déjà payée.
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
