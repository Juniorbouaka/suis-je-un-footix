import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Icon from './Icon.jsx';

/**
 * Bloc de soutien de la page d'accueil.
 *
 * Différent de SupportPrompt : celui-ci ne s'invite pas au milieu d'une
 * partie, il fait partie du contenu de la page. Aucune règle de fréquence
 * donc, mais deux exceptions de bon sens :
 *
 *   — les abonnés premium ne le voient pas, ils paient déjà ;
 *   — ceux qui ont déjà donné non plus.
 *
 * Le compteur de soutiens n'apparaît qu'à partir de trois personnes :
 * afficher « 1 personne a soutenu le jeu » dessert le propos.
 */
export default function SupportSection() {
  const { isPremium } = useAuth();

  const { data } = useQuery({
    queryKey: ['donate-stats'],
    queryFn: async () => (await api.get('/donate/stats')).data,
    staleTime: 5 * 60_000,
  });

  const dejaDonateur = (() => {
    try {
      return Boolean(JSON.parse(localStorage.getItem('footix.support') || '{}').donateur);
    } catch {
      return false;
    }
  })();

  if (isPremium || dejaDonateur) return null;

  const soutiens = data?.supporters ?? 0;

  return (
    <section className="support-section">
      <span className="support-section-icon">
        <Icon name="heart" size={24} strokeWidth={1.7} />
      </span>

      <div className="grow">
        <h2 className="support-section-title">Le jeu est gratuit, et le restera</h2>
        <p className="support-section-text">
          Chaque proposition que tu envoies est évaluée par une IA, et chaque évaluation coûte
          quelques centimes. Pas de compte obligatoire pour donner, pas d'engagement — et un don
          n'apporte aucun avantage dans le jeu.
        </p>

        <div className="row wrap" style={{ gap: 10, marginTop: 14 }}>
          <Link to="/soutenir" className="btn">
            <Icon name="heart" size={15} /> Soutenir le jeu
          </Link>
          <Link to="/premium" className="btn btn-ghost">
            <Icon name="crown" size={15} /> Voir le premium
          </Link>
        </div>

        {soutiens >= 3 && (
          <p className="small faint" style={{ marginTop: 12, marginBottom: 0 }}>
            {soutiens} personnes ont déjà soutenu le jeu.
          </p>
        )}
      </div>
    </section>
  );
}
