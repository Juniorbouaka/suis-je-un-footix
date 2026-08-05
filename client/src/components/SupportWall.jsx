import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';

/**
 * Le mur des soutiens.
 *
 * N'affiche que ceux qui ont explicitement demandé à y figurer, et jamais
 * les montants : le mur remercie, il ne classe pas. Rien ne doit laisser
 * penser qu'un gros don vaut mieux qu'un petit.
 */

function mois(iso) {
  if (!iso) return null;
  const [an, m] = iso.split('-');
  const noms = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  return `${noms[Number(m) - 1]} ${an.slice(2)}`;
}

export default function SupportWall() {
  const { data, isLoading } = useQuery({
    queryKey: ['donate-wall'],
    queryFn: async () => (await api.get('/donate/wall')).data,
    staleTime: 60_000,
  });

  if (isLoading) return null;

  const noms = data?.names || [];
  if (!noms.length) return null;

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 17, marginBottom: 4 }}>
        <Icon name="heart" size={15} /> Ils font vivre le jeu
      </h2>
      <p className="small muted" style={{ marginTop: 0, marginBottom: 14 }}>
        Merci à {noms.length === 1 ? 'cette personne' : 'ces personnes'}.
      </p>

      <div className="wall">
        {noms.map((n, i) => (
          <span key={`${n.name}-${i}`} className="wall-name">
            {n.name}
            {n.at && <span className="wall-date faint">{mois(n.at)}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
