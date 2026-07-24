import { tierOf } from './Gauge.jsx';

/** Historique scrollable des tentatives, trié du plus proche au plus loin. */
export default function GuessList({ guesses = [], sort = 'best', emptyLabel = 'Aucune tentative pour l’instant.' }) {
  if (!guesses.length) {
    return <p className="muted small center" style={{ padding: '18px 0' }}>{emptyLabel}</p>;
  }

  const latestWord = guesses.at(-1)?.word;
  const rows = [...guesses];
  if (sort === 'best') rows.sort((a, b) => b.score - a.score);
  else rows.reverse();

  return (
    <div className="guess-list">
      {rows.map((g, i) => {
        const tier = g.tier || tierOf(g.score).tier;
        return (
          <div
            key={`${g.word}-${g.attempt ?? i}`}
            className={`guess-row${g.word === latestWord ? ' is-latest' : ''}`}
          >
            <span className="guess-num">#{g.attempt ?? guesses.indexOf(g) + 1}</span>
            <span className="guess-word">{g.word}</span>
            <span className="guess-bar">
              <span className={`bg-${tier}`} style={{ width: `${Math.max(3, g.score)}%` }} />
            </span>
            <span className={`guess-score tier-${tier}`}>{g.score}</span>
          </div>
        );
      })}
    </div>
  );
}
