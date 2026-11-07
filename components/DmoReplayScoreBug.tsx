import type { Te4DmoReplayScore } from '@/lib/te4DmoReplayScoreboard';
import styles from './DmoReplayScoreBug.module.css';

type Props = {
  players: [string, string];
  score: Te4DmoReplayScore;
};

export default function DmoReplayScoreBug({ players, score }: Props) {
  const setSummary = score.sets.length
    ? score.sets.map(([first, second]) => `${first}–${second}`).join('  ')
    : 'No completed sets';
  const pointLabel = score.tiebreak ? 'TB' : 'Points';

  return (
    <aside className={styles.scoreboard} aria-label="Full match replay scoreboard">
      <div className={styles.header}>
        <span>{score.final ? 'Replay · Final' : `Replay · Set ${score.setNumber}`}</span>
        <strong aria-label="Completed set scores">{setSummary}</strong>
      </div>
      <div className={styles.table} role="table" aria-label="Player, games, points and server">
        <div className={styles.heading} role="row">
          <span role="columnheader">Player</span>
          <span role="columnheader">Games</span>
          <span role="columnheader">{pointLabel}</span>
          <span role="columnheader">Serve</span>
        </div>
        {players.map((name, index) => (
          <div className={styles.row} role="row" key={`${index}-${name}`}>
            <strong className={styles.player} role="cell" title={name}>
              {score.server === index + 1 && (
                <i className={styles.server} role="img" aria-label="Serving" />
              )}
              <span>{name}</span>
            </strong>
            <strong role="cell">{score.final ? '—' : score.games[index]}</strong>
            <strong className={styles.points} role="cell">
              {score.final ? '—' : score.pointText[index]}
            </strong>
            <span className={styles.serve} role="cell">
              {score.server === index + 1 ? 'Serving' : ''}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
