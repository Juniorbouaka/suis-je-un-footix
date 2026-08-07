import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Icon from './Icon.jsx';
import { detailPaiement, ouvrirDon, portefeuille } from '../lib/paiement.js';

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
 * Il était devenu invisible : une carte grise de plus, en bas de page, avec
 * un bouton de la même taille que tous les autres. Il a maintenant sa
 * couleur, son cadre et ses montants cliquables — un clic sur « 5 € » ouvre
 * directement le paiement, sans page intermédiaire. Sur téléphone, chaque
 * écran traversé fait perdre la moitié des gens.
 *
 * Ce qu'il ne fait toujours pas : promettre quoi que ce soit. Un don
 * n'apporte aucun avantage dans le jeu, et le texte le dit.
 *
 * Le compteur de soutiens n'apparaît qu'à partir de trois personnes :
 * afficher « 1 personne a soutenu le jeu » dessert le propos.
 */

/* Trois montants, pas plus : au-delà, choisir devient un effort. */
const RACCOURCIS = [2, 5, 10];

export default function SupportSection() {
  const { hasAccess } = useAuth();
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState('');
  const kind = portefeuille();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['donate-stats'],
    queryFn: async () => (await api.get('/donate/stats')).data,
    staleTime: 5 * 60_000,
  });

  const { data: options } = useQuery({
    queryKey: ['donate-options'],
    queryFn: async () => (await api.get('/donate/options')).data,
    staleTime: 5 * 60_000,
  });

  const dejaDonateur = (() => {
    try {
      return Boolean(JSON.parse(localStorage.getItem('footix.support') || '{}').donateur);
    } catch {
      return false;
    }
  })();

  // Un abonné, quel que soit son forfait, paie déjà le jeu : on ne lui
  // redemande rien. L'encart ne s'adresse plus qu'aux visiteurs.
  if (hasAccess || dejaDonateur) return null;

  const soutiens = data?.supporters ?? 0;
  const ouvert = options?.enabled !== false;
  const rapide = options?.providers?.stripe !== false;

  const donner = async (montant) => {
    if (busy) return;
    setBusy(montant);
    setError('');
    try {
      await ouvrirDon(montant, rapide ? 'stripe' : 'paypal');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(0);
      // Le serveur a peut-être desactivé la carte : on relit les moyens de
      // paiement plutôt que de laisser un raccourci qui ne mène nulle part.
      queryClient.invalidateQueries({ queryKey: ['donate-options'] });
    }
  };

  return (
    <section className="support-cta">
      <div className="support-cta-head">
        <span className="support-cta-icon">
          <Icon name="heart" size={26} strokeWidth={1.7} />
        </span>
        <div>
          <h2 className="support-cta-title">Un coup de pouce, sans abonnement</h2>
          <p className="support-cta-text">
            Chaque proposition envoyée est évaluée par une IA, et chaque évaluation coûte quelques
            centimes : c'est ce que finance l'abonnement. Un don, lui, n'oblige à rien — pas de
            compte à créer, pas d'engagement — et n'apporte <strong>aucun avantage</strong> dans le
            jeu, pas même une partie de plus.
          </p>
        </div>
      </div>

      {ouvert ? (
        <>
          {/* Un clic = le paiement s'ouvre. Aucune page intermédiaire. */}
          <div className="support-cta-montants">
            {RACCOURCIS.map((m) => (
              <button
                key={m}
                className="support-cta-montant"
                disabled={Boolean(busy)}
                onClick={() => donner(m)}
              >
                {busy === m ? '…' : `${m} €`}
              </button>
            ))}
            <Link to="/soutenir" className="support-cta-montant support-cta-autre">
              Autre
            </Link>
          </div>

          <p className="small faint center support-cta-moyens">
            {rapide ? detailPaiement(kind) : 'Paiement par PayPal, sans créer de compte'}
          </p>
        </>
      ) : (
        <p className="small muted center" style={{ margin: '14px 0 0' }}>
          Les dons ne sont pas encore ouverts — merci d'y avoir pensé.
        </p>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      <div className="support-cta-pied">
        <Link to="/soutenir" className="btn btn-lg support-cta-btn">
          <Icon name="heart" size={17} /> Soutenir le jeu
        </Link>
        <Link to="/premium" className="btn btn-ghost btn-lg">
          <Icon name="crown" size={16} /> Voir le premium
        </Link>
      </div>

      {soutiens >= 3 && (
        <p className="small faint center" style={{ marginTop: 12, marginBottom: 0 }}>
          {soutiens} personnes ont déjà soutenu le jeu.
        </p>
      )}
    </section>
  );
}
