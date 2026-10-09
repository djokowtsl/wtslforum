import PageHero from '@/components/PageHero';

const columns = ['#', 'Predictor', 'Points', 'Correct picks', 'Tournaments', 'Won', 'Avg score'];
const rows = [0, 1, 2, 3, 4];
const widths = ['32%', '22%', '18%', '16%', '12%', '16%', '20%'];

function PlaceholderBar({ width }: { width: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width,
        height: 13,
        borderRadius: 8,
        background: 'rgba(150, 170, 210, 0.16)',
      }}
    />
  );
}

export default function PredictionsLoading() {
  return (
    <>
      <PageHero eyebrow="WTSL Forum" title="Predictions leaderboard">
        Challonge prediction standings.
      </PageHero>
      <main className="container" aria-busy="true">
        <section className="panel" aria-label="Predictions leaderboard">
          <div className="panel-head">
            <h2 className="display">Top predictors</h2>
          </div>
          <table aria-hidden="true">
            <thead>
              <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row}>
                  {widths.map((width, index) => (
                    <td key={`${row}-${index}`}><PlaceholderBar width={width} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}
