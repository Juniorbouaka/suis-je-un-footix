import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import GuessList from './GuessList.jsx';
import ShareResult from './ShareResult.jsx';
import SupportPrompt from './SupportPrompt.jsx';
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
  maxAttempts = 15,
  premiumAttempts = 50,
  isPremium = false,
  training = null,
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

      {/* « Et maintenant ? » — la seule question du joueur à cet instant.
          Un abonné a une réponse : ses parties d'entraînement. Les autres
          ont la fenêtre modale, puis ce rappel qui, lui, reste à l'écran. */}
      {isPremium ? (
        <ReplayPanel training={training} />
      ) : (
        <div className="premium-note small muted" style={{ marginTop: 16 }}>
          <Icon name="crown" size={14} /> Une partie par jour en gratuit.{' '}
          <Link to="/premium">
            L'abonnement en donne {training?.gamesPerDay ?? 5}
          </Link>{' '}
          — dont {Math.max(1, (training?.gamesPerDay ?? 5) - 1)} d'entraînement, hors classement —
          avec {premiumAttempts} chances au lieu de {maxAttempts}.
        </div>
      )}

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

/**
 * Ce qu'il reste à jouer aujourd'hui, pour un abonné.
 *
 * On annonce un chiffre — « cinq parties par jour » — donc on doit le tenir
 * à l'écran. Un compteur qui affiche zéro est plus honnête qu'un bouton qui
 * mènerait à un refus.
 */
function ReplayPanel({ training }) {
  const restantes = training?.remaining ?? 0;
  const max = training?.max ?? 4;

  return (
    <div className={`replay-panel${restantes > 0 ? '' : ' vide'}`}>
      <span className="replay-panel-icon">
        <Icon name={restantes > 0 ? 'repeat' : 'clock'} size={18} />
      </span>
      <div className="grow">
        <div className="replay-panel-title">
          {restantes > 0 ? 'Envie de rejouer ?' : 'C’est tout pour aujourd’hui'}
        </div>
        <p className="small muted" style={{ margin: '2px 0 0' }}>
          {restantes > 0
            ? `Il te reste ${restantes} partie${restantes > 1 ? 's' : ''} d'entraînement sur ${max} — une journée d'archive, hors classement.`
            : `Tes ${max} parties d'entraînement sont utilisées. Tout se remet à zéro à minuit.`}
        </p>
      </div>
      {restantes > 0 && (
        <Link to="/archives" className="btn btn-sm">
          Choisir une journée
        </Link>
      )}
    </div>
  );
}
