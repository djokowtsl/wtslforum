export default function RatingMethodNote() {
  return (
    <aside className="rating-method-note" aria-label="How the overall ratings are calculated">
      <strong>How ratings are calculated</strong>
      <p>
        Serve: 1st Serve % + 1st Serve Won % + 2nd Serve Won % + Aces − Double Faults.
        Return: 1st Serve Return Points Won % + 2nd Serve Return Points Won % + Break Points Won %.
        Under Pressure: Break Points Won % + Break Points Saved % + Tie-breaks Won % + Deciding Sets Won %.
        Missing components are omitted.
      </p>
    </aside>
  );
}