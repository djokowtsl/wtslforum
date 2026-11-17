import type { Te4DmoReplayScore } from '@/lib/te4DmoReplayScoreboard';
import styles from './DmoReplayScoreBug.module.css';

type Props = {
  players: [string, string];
  score: Te4DmoReplayScore;
  bestOf?: number;
};

export default function DmoReplayScoreBug({ players, score, bestOf = 3 }: Props) {
  const setCount = Math.max(1, bestOf, score.setNumber, score.sets.length);
  const setScores = Array.from({ length: setCount }, (_, index) => {
    if (score.final) return score.sets[index] ?? null;
    if (index === score.setNumber - 1) return score.games;
    return score.sets[index] ?? null;
  });
  const pointLabel = score.tiebreak ? 'TB' : 'Points';
  const columns = `minmax(92px, 1fr) repeat(${setCount}, minmax(28px, 42px))${score.final ? '' : ' minmax(38px, 46px)'}`;

  return (
    <aside className={styles.scoreboard} aria-label="Full match replay scoreboard">
      <div className={styles.header}>
        <span>Full match</span>
        <strong>{score.final ? 'Final' : `Set ${score.setNumber}`}</strong>
      </div>
      <div className={styles.table} role="table" aria-label="Players, set scores and current point">
        <div className={styles.heading} role="row" style={{ gridTemplateColumns: columns }}>
          <span role="columnheader">Player</span>
          {setScores.map((_, index) => (
            <span
              className={!score.final && index === score.setNumber - 1 ? styles.activeSet : undefined}
              role="columnheader"
              key={`set-${index + 1}`}
              aria-current={!score.final && index === score.setNumber - 1 ? 'true' : undefined}
            >
              {index + 1}
            </span>
          ))}
          {!score.final && <span role="columnheader">{pointLabel}</span>}
        </div>
        {players.map((name, index) => (
          <div className={styles.row} role="row" key={`${index}-${name}`} style={{ gridTemplateColumns: columns }}>
            <strong className={styles.player} role="cell" title={name}>
              {score.server === index + 1 && (
                <i className={styles.server} role="img" aria-label="Serving" />
              )}
              <span>{name}</span>
            </strong>
            {setScores.map((setScore, setIndex) => (
              <strong
                className={!score.final && setIndex === score.setNumber - 1
                  ? `${styles.setScore} ${styles.currentSetScore}`
                  : styles.setScore}
                role="cell"
                key={`set-${setIndex + 1}`}
              >
                {setScore ? setScore[index] : '—'}
              </strong>
            ))}
            {!score.final && (
              <strong className={styles.points} role="cell">{score.pointText[index]}</strong>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
