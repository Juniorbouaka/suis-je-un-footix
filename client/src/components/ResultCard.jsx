import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import GuessList from './GuessList.jsx';
import ShareResult from './ShareResult.jsx';
import SupportPrompt from './SupportPrompt.jsx';
import NextGame from './NextGame.jsx';
import AdSlot from './Ads.jsx';

/**
 * L'écran de fin de partie solo.
 *
 * Extrait de la page Solo pour une raison précise : c'est l'écran le plus
 * chargé du jeu — résultat, bio, médailles, partage, offre, soutien — et
 * c'est aussi celui qu'on retouche le plus souvent. Il fallait pouvoir le
 * regarder sans finir une partie, d'où la page /test/fin-de-partie qui
 * l'affiche avec des données inventées. Un écran de démonstration qui
 * recopierait le vrai finirait par mentir : ici, les deux sont le même
 * composant.
 *
 * L'ordre des blocs est une décision, pas un hasard : d'abord ce que le
 * joueur a fait, ensuite ce qu'il peut partager, et seulement après ce
 * qu'on lui propose. Rien à vendre avant d'avoir rendu son résultat.
 */

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m} min ${String(s).padStart(2, '0')} s` : `${s} s`;
}

function titrePour(result, maxAttempts) {
  if (result.outcome === 'exhausted') return `Tes ${maxAttempts} chances sont passées`;
  if (result.outcome === 'surrendered') return 'Partie abandonnée';
  return `Trouvé en ${result.attempts} tentative${result.attempts > 1 ? 's' : ''}`;
}

export default function ResultCard({
  result,
  description,
  guesses = [],
  unlocked = [],
  puzzleNumber,
  maxAttempts = 20,
  isPremium = false,
  credits = null,
  serie = 0,
  // La page de test veut voir l'encart de soutien, que ses règles de
  // fréquence masqueraient neuf fois sur dix.
  forcerSoutien = false,
}) {
  const gagne = result.outcome === 'found';

  return (
    <div className="card">
      <div className="result-hero">
        <div className="result-icon">
          <Icon name={gagne ? 'trophy' : 'flag'} size={44} strokeWidth={1.5} />
        </div>
        <h2 style={{ fontSize: 24, margin: '10px 0 6px' }}>{titrePour(result, maxAttempts)}</h2>
        <p className="muted">Le joueur mystère était</p>
        <p className="result-word">{result.word}</p>

        {description && (
          <div className="bio">
            <span className="bio-label">Qui est-ce ?</span>
            {description}
          </div>
        )}
      </div>

      <div className="stat-grid" style={{ marginTop: 18 }}>
        <div className="stat">
          <div className="stat-value">{result.attempts}</div>
          <div className="stat-label">Tentatives</div>
        </div>
        <div className="stat">
          <div className="stat-value">{formatDuration(result.seconds || 0)}</div>
          <div className="stat-label">Temps</div>
        </div>
        <div className="stat">
          <div className="stat-value tier-blazing">{result.score}</div>
          <div className="stat-label">Points</div>
        </div>
      </div>

      {/*
        Partie hors classement : le score reste affiché — le joueur a le droit
        de savoir comment il a joué — mais il faut dire tout de suite qu'il ne
        compte pas. L'apprendre plus tard, en cherchant sa place au tableau,
        serait la mauvaise façon de le découvrir.
      */}
      {result.ranked === false && gagne && (
        <p className="small muted center" style={{ marginTop: 10 }}>
          <Icon name="repeat" size={13} /> Partie hors classement : une seule compte par jour, et
          c'était la première. Payer achète du temps de jeu, jamais des points.
        </p>
      )}

      {unlocked.length > 0 && (
        <div className="stack-sm" style={{ marginTop: 18 }}>
          <h3 style={{ fontSize: 16 }}>Médailles débloquées</h3>
          <div className="badge-grid">
            {unlocked.map((a) => (
              <div key={a.code} className="badge earned">
                <span className="badge-icon">
                  <Icon name="medal" size={20} />
                </span>
                <div>
                  <div className="badge-name">{a.name}</div>
                  <div className="badge-desc">{a.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ShareResult
        puzzleNumber={puzzleNumber}
        attempts={result.attempts}
        score={result.score}
        guesses={guesses}
        outcome={result.outcome}
        maxAttempts={maxAttempts}
      />

      {/* « Et maintenant ? » — la seule question du joueur à cet instant, et
          la réponse tient dans son solde. */}
      <ReplayPanel credits={credits} isPremium={isPremium} />

      {/* Affiche quelle que soit l'issue, mais le TEXTE change : apres un
          echec on ne felicite pas et on ne reclame pas, on constate. */}
      <SupportPrompt
        contexte="solo"
        serie={serie}
        issue={gagne ? 'gagne' : 'perdu'}
        force={forcerSoutien}
      />

      <AdSlot slot="1234567890" />

      <div className="row wrap" style={{ marginTop: 20, gap: 10 }}>
        <Link to="/duel" className="btn btn-ghost grow">
          <Icon name="swords" /> Jouer en duel
        </Link>
        <Link to="/classement" className="btn btn-ghost grow">
          Voir le classement
        </Link>
      </div>

      {guesses.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>Tes {guesses.length} tentatives</h3>
          <GuessList guesses={guesses} sort="best" />
        </div>
      )}
    </div>
  );
}

/** La date de recharge, en français, sans l'heure. */
function jour(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

/**
 * Ce qu'il reste à jouer, tout de suite.
 *
 * Le joueur vient de finir sa partie du jour : la question suivante est
 * « est-ce que je peux en refaire une ? », et le solde y répond sans détour.
 * Un compteur qui affiche zéro est plus honnête qu'un bouton qui mènerait à
 * un refus.
 *
 * À zéro, la réponse n'est plus « reviens demain » : c'est le sujet de cet
 * encart. Le rendez-vous du lendemain est acquis quoi qu'il arrive — il est
 * compris dans l'abonnement — et pour jouer TOUT DE SUITE il y a une
 * recharge. On propose donc les deux, dans cet ordre : ce qui est déjà
 * gagné, puis ce qui s'achète.
 *
 * Au-dessus de zéro, l'encart ne se contente plus d'annoncer le solde : il
 * lance la partie suivante. Renvoyer vers une liste de dates un joueur qui
 * a déjà payé ses parties, c'est lui demander de faire le travail avant de
 * pouvoir dépenser ce qu'il a acheté. Le lien vers les archives reste, en
 * second, pour qui veut une journée précise.
 */
function ReplayPanel({ credits, isPremium }) {
  const restantes = credits?.balance ?? 0;
  const recharge = jour(credits?.nextRecharge);

  return (
    <div className={`replay-panel${restantes > 0 ? '' : ' vide'}`}>
      <span className="replay-panel-icon">
        <Icon name={restantes > 0 ? 'repeat' : 'clock'} size={18} />
      </span>
      <div className="grow">
        <div className="replay-panel-title">
          {restantes > 0 ? 'Envie de rejouer ?' : 'Plus de parties en réserve'}
        </div>
        <p className="small muted" style={{ margin: '2px 0 0' }}>
          {restantes > 0
            ? `Il te reste ${restantes} partie${restantes > 1 ? 's' : ''} en réserve. Enchaîne tout de suite sur un autre joueur mystère — hors classement, une partie décomptée.`
            : `Le joueur de demain t'attend, il est compris dans ton abonnement.${
                recharge ? ` Ta réserve se recharge le ${recharge}.` : ''
              } Pour rejouer maintenant, tu peux prendre des parties à l'unité${
                isPremium ? '' : " ou passer à l'Illimité"
              }.`}
        </p>
      </div>
      {restantes > 0 ? (
        <div className="row wrap" style={{ gap: 8 }}>
          <NextGame />
          <Link to="/archives" className="btn btn-sm btn-ghost">
            Choisir
          </Link>
        </div>
      ) : (
        <Link to="/premium#recharges" className="btn btn-sm">
          Prendre des parties
        </Link>
      )}
    </div>
  );
}
