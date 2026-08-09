import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, creditsDeLErreur, errorMessage, sansCredit } from '../lib/api.js';
import { publierCredits } from '../lib/credits.js';
import Icon from './Icon.jsx';

/**
 * « Enchaîner » — une partie de plus, tout de suite.
 *
 * Le bouton qui manquait à la fin d'une partie. Jusqu'ici la seule suite
 * possible était un lien vers les archives : le joueur qui venait de trouver
 * son joueur mystère devait retourner à une liste de dates et en choisir une
 * pour dépenser ce qu'il avait payé. Une réserve de parties qu'il faut aller
 * chercher n'est pas une réserve, c'est un rangement.
 *
 * Ce bouton demande au serveur la partie suivante — il la choisit, on ne la
 * choisit pas — et ouvre l'écran de jeu. Le lien vers les archives reste à
 * côté, pour qui préfère décider lui-même.
 *
 * Deux choses qu'il ne fait PAS, et c'est ce qui le rend sûr à cliquer :
 *
 *   — il ne débite rien. Le prix tombe à la première proposition, comme
 *     pour toute journée d'archive. Cliquer puis revenir en arrière ne coûte
 *     donc pas une partie.
 *   — il ne devine pas le solde. À zéro, le serveur refuse et son message
 *     s'affiche ici : mieux vaut un refus lisible qu'un écran de jeu qui se
 *     ferme au premier mot.
 */
export default function NextGame({
  label = 'Enchaîner une partie',
  className = 'btn btn-sm',
  wrapperClassName = 'next-game',
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState('');

  const lancer = async () => {
    if (busy) return;
    setBusy(true);
    setErreur('');
    try {
      const { data } = await api.get('/archive/suivante');
      // Le solde n'a pas bougé — rien n'est débité ici — mais il a pu
      // changer ailleurs depuis le chargement de l'écran, et cette réponse
      // porte le plus frais.
      publierCredits(data.credits);
      navigate(`/archives/${data.date}`);
    } catch (err) {
      // Portefeuille vide : le solde à jour voyage avec le refus, on le
      // publie pour que l'encart bascule tout de suite sur la recharge.
      if (sansCredit(err)) publierCredits(creditsDeLErreur(err));
      setErreur(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className={wrapperClassName}>
      <button className={className} onClick={lancer} disabled={busy}>
        <Icon name="repeat" size={15} /> {busy ? 'On y va…' : label}
      </button>
      {erreur && (
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          {erreur}
        </p>
      )}
    </div>
  );
}
