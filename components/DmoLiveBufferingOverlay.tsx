import styles from './DmoLiveBufferingOverlay.module.css';

type Props = { buffering: boolean };

export default function DmoLiveBufferingOverlay({ buffering }: Props) {
  if (!buffering) return null;

  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <div className={styles.message}>
        <span className={styles.spinner} aria-hidden="true" />
        <strong>Buffering live court</strong>
        <small>Waiting for the next match update</small>
      </div>
    </div>
  );
}
