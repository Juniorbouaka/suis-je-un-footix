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
  solo: 'Partie du jour',
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
  const mensuel = vivant?.monthly ?? 0;
  const recharge = jour(vivant?.nextRecharge);
  const mouvements = data?.history || [];
  // La jauge : ce qu'il reste sur ce qui a été servi. Bornée à 100 %, parce
  // qu'un changement de formule en cours de mois peut donner un solde
  // supérieur au stock de l'ancienne formule pendant quelques secondes.
  const part = mensuel > 0 ? Math.min(100, Math.round((solde / mensuel) * 100)) : 0;

  return (
    <section id="portefeuille" className="card" style={{ marginBottom: 18 }}>
      <div className="row row-between wrap" style={{ marginBottom: 14, gap: 10 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>
          <Icon name="target" size={16} /> Ton stock de parties
        </h2>
        {!isPremium && (
          <Link to="/premium" className="btn btn-sm btn-ghost">
            Passer à l'Illimité
          </Link>
        )}
      </div>

      <div className="row row-between wrap" style={{ gap: 10, marginBottom: 8 }}>
        <div>
          <span className="stat-value" style={{ fontSize: 30 }}>
            {solde}
          </span>{' '}
          <span className="muted">partie{solde > 1 ? 's' : ''} sur {mensuel}</span>
        </div>
        <span className="small muted">
          {recharge ? `Recharge le ${recharge}` : 'Recharge tous les mois'}
        </span>
      </div>

      {/* Une barre plutôt qu'un simple chiffre : « il m'en reste combien ? »
          se répond mieux d'un coup d'œil que par une soustraction. */}
      <div className="credit-bar" aria-hidden="true">
        <span className="credit-bar-fill" style={{ width: `${part}%` }} />
      </div>

      <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
        Une partie du jour, une journée d'archive ou un duel coûtent une partie du stock. Une
        invitation en coûte deux — tu offres celle de ton adversaire. Reprendre une partie déjà
        commencée ne coûte rien.
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
