import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useCredits } from '../lib/credits.js';
import Icon from './Icon.jsx';

/**
 * Le portefeuille et son relevé, dans le profil.
 *
 * Un compteur d'argent sans relevé n'est pas un compteur d'argent. « J'ai
 * perdu trois parties sans jouer » est une phrase qu'on entendra, et la
 * seule réponse acceptable est une liste que le joueur peut lire lui-même —
 * pas notre parole contre la sienne.
 *
 * Le relevé raconte l'aller ET le retour : une partie débitée puis rendue
 * (panne de l'évaluateur, duel annulé) laisse deux lignes qui s'annulent
 * plutôt qu'une ligne effacée. Un relevé où les mouvements disparaissent ne
 * prouve plus rien, et c'est précisément le jour où quelqu'un conteste qu'on
 * en a besoin.
 */

/* Les motifs viennent du serveur en langage de serveur. On les traduit ici
   plutôt qu'à la source : le journal doit rester lisible par nous, et
   l'écran par le joueur. */
const MOTIFS = {
  // « solo » n'apparaît plus dans les nouveaux mouvements — la partie du
  // jour est incluse — mais les anciens relevés le portent encore, et un
  // motif brut au milieu d'un historique fait tache.
  solo: 'Partie du jour',
  'recharge-achetee': 'Recharge achetée',
  archive: 'Journée d’archive',
  'archive-recommence': 'Journée recommencée',
  duel: 'Duel',
  'duel-invitation': 'Duel sur invitation (deux joueurs)',
  recharge: 'Recharge mensuelle',
  'recharge-filet': 'Recharge mensuelle',
  'premiere-recharge': 'Premier stock',
  souscription: 'Souscription',
  renouvellement: 'Renouvellement',
  'changement-de-formule': 'Changement de formule',
  'remboursement-evaluateur': 'Remboursé — évaluateur indisponible',
  'remboursement-duel-annule': 'Remboursé — duel annulé',
};

function quand(iso) {
  if (!iso) return '';
  // Le journal est en UTC : sans le marqueur, le navigateur le lirait comme
  // une heure locale et décalerait chaque ligne.
  return new Date(`${iso.replace(' ', 'T')}Z`).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function jour(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

export default function CreditWallet() {
  const { hasAccess, isPremium, credits: duProfil } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['billing-credits'],
    queryFn: async () => (await api.get('/billing/credits')).data,
    enabled: hasAccess,
  });

  // Le solde du dépôt commun l'emporte : il a pu bouger depuis le chargement
  // de cette page, si une partie s'est jouée dans un autre onglet.
  const vivant = useCredits(data || duProfil);

  if (!hasAccess) return null;

  const solde = vivant?.balance ?? 0;
  const duMois = vivant?.fromPlan ?? 0;
  const achetees = vivant?.purchased ?? 0;
  const mensuel = vivant?.monthly ?? 0;
  const recharge = jour(vivant?.nextRecharge);
  const mouvements = data?.history || [];
  // La jauge ne montre que la poche MENSUELLE : c'est la seule qui se vide
  // et se remplit au rythme d'un mois. Y mêler les parties achetées ferait
  // une barre qui dépasse son propre maximum.
  const part = mensuel > 0 ? Math.min(100, Math.round((duMois / mensuel) * 100)) : 0;

  return (
    <section id="portefeuille" className="card" style={{ marginBottom: 18 }}>
      <div className="row row-between wrap" style={{ marginBottom: 14, gap: 10 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>
          <Icon name="target" size={16} /> Tes parties supplémentaires
        </h2>
        <Link to="/premium#recharges" className="btn btn-sm btn-ghost">
          {isPremium ? 'Prendre des parties' : 'Recharger ou passer à l’Illimité'}
        </Link>
      </div>

      {/* La promesse acquise, avant le compteur : le rendez-vous quotidien
          ne dépend d'aucun solde, et c'est la première chose à savoir en
          arrivant sur cet écran. */}
      <p className="small" style={{ marginTop: 0, marginBottom: 14 }}>
        <Icon name="check" size={13} /> Le joueur mystère du jour est compris dans ton abonnement,
        tous les jours, sans rien décompter.
      </p>

      <div className="row row-between wrap" style={{ gap: 10, marginBottom: 8 }}>
        <div>
          <span className="stat-value" style={{ fontSize: 30 }}>
            {solde}
          </span>{' '}
          <span className="muted">
            partie{solde > 1 ? 's' : ''} en réserve
            {achetees > 0 ? ` — dont ${achetees} achetée${achetees > 1 ? 's' : ''}` : ''}
          </span>
        </div>
        <span className="small muted">
          {duMois}/{mensuel} du mois{recharge ? ` · recharge le ${recharge}` : ''}
        </span>
      </div>

      {/* Une barre plutôt qu'un simple chiffre : « il m'en reste combien ? »
          se répond mieux d'un coup d'œil que par une soustraction. */}
      <div className="credit-bar" aria-hidden="true">
        <span className="credit-bar-fill" style={{ width: `${part}%` }} />
      </div>

      <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
        Une journée d'archive rejouée ou un duel coûtent une partie. Une invitation en coûte deux —
        tu offres celle de ton adversaire. Reprendre une partie déjà commencée ne coûte rien.
        {achetees > 0
          ? ' Les parties achetées ne périment pas : elles restent après la recharge du mois.'
          : ''}
      </p>

      <h3 style={{ fontSize: 15, margin: '20px 0 8px' }}>Tes derniers mouvements</h3>

      {isLoading ? (
        <div className="spinner" />
      ) : mouvements.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          Aucun mouvement pour l'instant.
        </p>
      ) : (
        <div className="stack-sm">
          {mouvements.map((m, i) => (
            <div key={`${m.createdAt}-${i}`} className="credit-row">
              <span className={`credit-delta${m.delta > 0 ? ' plus' : ''}`}>
                {m.delta > 0 ? `+${m.delta}` : m.delta}
              </span>
              <span className="grow">{MOTIFS[m.reason] || m.reason}</span>
              <span className="small faint mono hide-sm">{quand(m.createdAt)}</span>
              <span className="small faint mono">solde {m.balance}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
