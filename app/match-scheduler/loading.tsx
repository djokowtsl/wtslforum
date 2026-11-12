export default function MatchSchedulerLoading() {
  return (
    <main className="scheduler-page" aria-label="Loading match schedules">
      <div className="scheduler-skeleton" />
      <div className="scheduler-section">
        <div className="scheduler-heading"><div><h2>Your draw matches</h2><p>Loading official WTSL match data…</p></div></div>
        <div className="scheduler-match-list"><div className="scheduler-skeleton" /><div className="scheduler-skeleton" /></div>
      </div>
    </main>
  );
}
