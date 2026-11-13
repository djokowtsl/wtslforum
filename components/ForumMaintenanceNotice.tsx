import styles from './ForumMaintenanceNotice.module.css';

export function ForumMaintenanceNotice() {
  return (
    <main className={styles.screen} role="status">
      <section className={styles.card} aria-labelledby="maintenance-title">
        <div className={styles.brand}>
          <span className={styles.ball} aria-hidden="true" />
          <span>WTSL Forum</span>
        </div>
        <p className={styles.eyebrow}>Scheduled maintenance</p>
        <h1 id="maintenance-title">The Forum is temporarily unavailable</h1>
        <p className={styles.message}>
          We’re carrying out planned maintenance and preparing match replays.
          The Forum is expected to be available again at 08:00 GMT on Saturday,
          14 November.
        </p>
        <div className={styles.returnTime}>
          <span>Expected return</span>
          <time dateTime="2026-11-14T08:00:00Z">08:00 GMT · 14 November 2026</time>
        </div>
        <p className={styles.thanks}>Thank you for your patience.</p>
      </section>
    </main>
  );
}
