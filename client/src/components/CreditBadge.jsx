import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useCredits } from '../lib/credits.js';
import Icon from './Icon.jsx';

/**
 * Le solde, en permanence dans l'en-tête.
 *
 * Un compteur qu'on ne voit qu'au moment où il bloque n'est pas un
 * compteur, c'est un piège. Celui-ci est visible avant chaque clic, sur
 * toutes les pages, pour que « il ne me reste que deux parties » soit une
 * information et jamais une surprise.
 *
 * Il est compté en PARTIES et non en crédits : c'est la seule unité qui
 * veuille dire quelque chose pour quelqu'un qui vient jouer. Le mot
 * « crédit » n'apparaît que dans le relevé du profil, là où l'on vérifie ses
 * comptes.
 *
 * Il mène à l'offre, toujours : quand le solde fond, la question suivante est
 * « comment j'en ai plus ? », et la réponse doit être à un clic.
 */
export default function CreditBadge() {
  const { hasAccess, credits: duProfil } = useAuth();
  const credits = useCredits(duProfil);

  if (!hasAccess || !credits) return null;

  const solde = credits.balance ?? 0;
  const vide = solde <= 0;

  return (
    <Link
      // À sec, le badge mène là où l'on peut y remédier ; sinon au relevé.
      // Un compteur vide qui ne mène qu'à sa propre constatation n'aide
      // personne.
      to={vide ? '/premium#recharges' : '/profil#portefeuille'}
      className={`pill credit-pill${vide ? ' credit-pill-empty' : ''}`}
      title={
        vide
          ? 'Plus de parties en réserve — le joueur du jour reste compris dans ton abonnement.'
          : `${solde} partie(s) en réserve, pour les archives et les duels`
      }
    >
      <Icon name="target" size={13} />
      <strong className="mono">{solde}</strong>
      <span className="hide-sm">partie{solde > 1 ? 's' : ''}</span>
    </Link>
  );
}
