import styles from './TournamentBracket.module.css';

export default function TournamentBracket({
  tournamentKey,
  tournamentName,
  challongeUrl,
}: {
  tournamentKey: string;
  tournamentName: string;
  challongeUrl: string | null;
}) {
  return (
    <section className={styles.bracket} aria-labelledby="tournament-bracket-title">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>LIVE TOURNAMENT DRAW</span>
          <h2 id="tournament-bracket-title">{tournamentName} bracket</h2>
          <p>Player character picks are shown in square brackets.</p>
        </div>
        {challongeUrl && (
          <a href={challongeUrl} target="_blank" rel="noreferrer">
            Open Challonge draw ↗
          </a>
        )}
      </header>
      <div
        className={styles.viewport}
        role="region"
        aria-label={`${tournamentName} bracket; scroll horizontally to inspect rounds`}
        tabIndex={0}
      >
        <img
          className={styles.image}
          src={`/api/tournaments/${encodeURIComponent(tournamentKey)}/bracket`}
          alt={`${tournamentName} tournament bracket with player character picks in square brackets`}
          loading="lazy"
        />
      </div>
      <p className={styles.note}>The bracket refreshes from Challonge periodically.</p>
    </section>
  );
}
