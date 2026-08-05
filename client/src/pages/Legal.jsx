import { Link } from 'react-router-dom';

/**
 * Pages légales.
 *
 * L'identité de l'éditeur et son adresse sont renseignées, comme
 * l'imposent l'article 6-III de la LCEN et, dès le premier abonnement
 * encaissé, l'article L221-5 du code de la consommation.
 *
 * Reste UNE ADRESSE DE CONTACT, surlignée en jaune sur la page et tout
 * aussi obligatoire. Prévoir une adresse dédiée, pas une adresse
 * personnelle : elle sera publique et aspirée par les robots.
 *
 * Ces textes ne remplacent pas l'avis d'un juriste, en particulier dès
 * qu'il y a encaissement d'abonnements.
 */

const ACOMPLETER = ({ children }) => <mark className="todo-legal">{children}</mark>;

function Page({ title, updated, children }) {
  return (
    <div className="legal" style={{ maxWidth: 720, margin: '0 auto' }}>
      <Link to="/" className="small muted">
        ← Retour au jeu
      </Link>
      <h1 style={{ fontSize: 27, margin: '10px 0 4px' }}>{title}</h1>
      <p className="muted small">Dernière mise à jour : {updated}</p>
      <div className="card" style={{ marginTop: 18 }}>
        {children}
      </div>
    </div>
  );
}

const MAJ = 'août 2026';

/* ================================================================ *
 *  Mentions légales
 * ================================================================ */

export function MentionsLegales() {
  return (
    <Page title="Mentions légales" updated={MAJ}>
      <h2>Éditeur du site</h2>
      <p>
        Le site « Suis-je un footix ? » est édité par <strong>Junior Bouaka</strong>, entrepreneur
        individuel sous le régime de la micro-entreprise, immatriculé au répertoire SIRENE sous le
        numéro SIRET <span className="mono">822 326 526 00016</span> (SIREN{' '}
        <span className="mono">822 326 526</span>).
      </p>
      <p>
        Adresse : 34 rue Salvador Allende, 92000 Nanterre, France
        <br />
        Contact : <ACOMPLETER>adresse e-mail de contact</ACOMPLETER>
        <br />
        Directeur de la publication : <strong>Junior Bouaka</strong>
      </p>

      <h2>Hébergement</h2>
      <p>
        Le site est hébergé par <strong>Railway Corporation</strong>, société de droit américain.{' '}
        <ACOMPLETER>Adresse du siège à recopier depuis railway.com/legal — à vérifier</ACOMPLETER>
      </p>

      <h2>Propriété intellectuelle</h2>
      <p>
        L'ensemble des éléments du site — code, textes, interface, identité visuelle — est protégé
        par le droit d'auteur. Toute reproduction ou réutilisation sans autorisation préalable est
        interdite.
      </p>
      <p>
        Les noms de footballeurs, de clubs et de compétitions cités sont mentionnés à titre
        informatif dans le cadre d'un jeu de connaissance. Le site n'est affilié à aucun club,
        fédération ni compétition.
      </p>

      <h2>Responsabilité</h2>
      <p>
        Les évaluations de proximité sont produites par un modèle de langage : elles peuvent
        comporter des erreurs ou des approximations. Elles n'ont aucune valeur documentaire et ne
        constituent pas une source d'information fiable sur les personnes citées.
      </p>
    </Page>
  );
}

/* ================================================================ *
 *  Confidentialité
 * ================================================================ */

export function Confidentialite() {
  return (
    <Page title="Politique de confidentialité" updated={MAJ}>
      <p>
        Cette page décrit les données que le site collecte, pourquoi, et comment tu peux les
        récupérer ou les supprimer.
      </p>

      <h2>Responsable du traitement</h2>
      <p>
        <strong>Junior Bouaka</strong>, entrepreneur individuel, éditeur du site (voir les{' '}
        <Link to="/mentions-legales">mentions légales</Link>). Pour toute question relative à tes
        données : <ACOMPLETER>adresse e-mail de contact</ACOMPLETER>.
      </p>

      <h2>Données collectées</h2>
      <table className="legal-table">
        <thead>
          <tr>
            <th>Donnée</th>
            <th>Pourquoi</th>
            <th>Base légale</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Pseudo, adresse e-mail, mot de passe (chiffré)</td>
            <td>Créer et sécuriser ton compte</td>
            <td>Exécution du contrat</td>
          </tr>
          <tr>
            <td>Parties, propositions, scores, médailles</td>
            <td>Faire fonctionner le jeu et le classement</td>
            <td>Exécution du contrat</td>
          </tr>
          <tr>
            <td>Identifiant d'abonnement PayPal, statut, échéance</td>
            <td>Ouvrir et maintenir les droits premium</td>
            <td>Exécution du contrat</td>
          </tr>
          <tr>
            <td>Identifiant de présence anonyme</td>
            <td>Compter les visiteurs en ligne</td>
            <td>Intérêt légitime</td>
          </tr>
          <tr>
            <td>Cookies publicitaires</td>
            <td>Financer le jeu par la publicité</td>
            <td>Ton consentement, révocable</td>
          </tr>
        </tbody>
      </table>

      <p className="small muted">
        Le mot de passe n'est jamais stocké en clair : seule une empreinte bcrypt est conservée,
        dont le mot de passe ne peut pas être déduit.
      </p>

      <h2>Destinataires</h2>
      <ul>
        <li>
          <strong>Anthropic</strong> — les mots que tu proposes sont envoyés à l'API Claude pour
          être évalués. Aucune donnée de compte n'accompagne ces requêtes.
        </li>
        <li>
          <strong>PayPal</strong> — traite le paiement si tu t'abonnes. Le site ne voit jamais tes
          coordonnées bancaires.
        </li>
        <li>
          <strong>Google</strong> — diffuse les publicités, uniquement si tu y as consenti.
        </li>
        <li>
          <strong>Resend</strong> — expédie les e-mails de réinitialisation de mot de passe.
        </li>
      </ul>

      <h2>Durée de conservation</h2>
      <p>
        Tes données sont conservées tant que ton compte existe. Les jetons de session expirent
        automatiquement, et les demandes de réinitialisation de mot de passe au bout d'une heure.
      </p>

      <h2>Tes droits</h2>
      <p>
        Tu disposes d'un droit d'accès, de rectification, d'effacement, de limitation, d'opposition
        et de portabilité. La suppression est immédiate et complète depuis ton{' '}
        <Link to="/profil">profil</Link> : compte, parties, scores et médailles partent ensemble,
        sans délai ni intervention de notre part.
      </p>
      <p className="small muted">
        En cas de désaccord, tu peux saisir la CNIL —{' '}
        <a href="https://www.cnil.fr" target="_blank" rel="noreferrer noopener">
          cnil.fr
        </a>
        .
      </p>
    </Page>
  );
}

/* ================================================================ *
 *  Cookies
 * ================================================================ */

export function Cookies() {
  return (
    <Page title="Politique cookies" updated={MAJ}>
      <h2>Ce qui est strictement nécessaire</h2>
      <p>
        Le site conserve dans ton navigateur ta session de connexion, ton choix de thème clair ou
        sombre, et ton choix en matière de publicité. Ces éléments sont indispensables au
        fonctionnement du site et ne demandent pas de consentement.
      </p>

      <h2>Publicité</h2>
      <p>
        Si tu l'acceptes, Google dépose des cookies publicitaires permettant d'afficher des
        annonces et de mesurer leur audience. Tu peux refuser : le jeu reste strictement identique,
        seules les annonces deviennent non personnalisées.
      </p>
      <p>
        Ton choix est modifiable à tout moment depuis le bandeau de gestion du consentement, en bas
        de page.
      </p>

      <h2>Aucune mesure d'audience tierce</h2>
      <p>
        Le site n'utilise ni Google Analytics ni aucun autre traceur d'audience. Le compteur de
        visiteurs en ligne repose sur un identifiant anonyme, expirant au bout de quarante
        secondes d'inactivité, qui n'est rattaché à aucun compte.
      </p>

      <h2>Comment supprimer les cookies</h2>
      <p>
        Tous les navigateurs permettent de supprimer les cookies déjà déposés et d'en bloquer le
        dépôt, depuis leurs préférences. Supprimer les cookies du site te déconnectera et
        réinitialisera ton choix publicitaire.
      </p>
    </Page>
  );
}
