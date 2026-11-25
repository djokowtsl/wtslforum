import Link from 'next/link';
import { redirect } from 'next/navigation';
import PageHero from '@/components/PageHero';
import styles from '@/components/DmoIntegrity.module.css';
import { DmoIntegrityRescanButton, DmoIntegrityScanPending } from '@/components/DmoIntegrityScanControls';
import { getSession } from '@/lib/auth';
import { safe } from '@/lib/db';
import {
  countPendingIntegrityScans,
  listDmoIntegrityScans,
  type DmoIntegrityRow,
} from '@/lib/dmoIntegrity';
import {
  compareIntegrityScans,
  DMO_INTEGRITY_LEVELS,
  type DmoIntegrityLevel,
} from '@/lib/dmoIntegrityScore.mjs';

export const dynamic = 'force-dynamic';

const LEVEL_ORDER: DmoIntegrityLevel[] = ['high', 'medium', 'weak', 'none'];

function clock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function dateText(value: string | Date) {
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
}

const GRADE_NAMES: Record<number, string> = {
  3: 'Converging indicators',
  2: 'Intermediate',
  1: 'Weak / exploratory',
};

function recordedAimText(recorded: { minCm: number; maxCm: number; plateau: boolean } | null | undefined) {
  if (!recorded) return 'No recorded aim for this passage, so it could not be checked.';
  const range = `${Math.round(recorded.minCm)}–${Math.round(recorded.maxCm)} cm`;
  return recorded.plateau
    ? `Recorded aim confirms it: held at ${range} (a plateau, as an aiming script would).`
    : `Recorded aim does not confirm it: moved ${range}, not held on a plateau.`;
}

function sortKey(row: DmoIntegrityRow) {
  return {
    status: row.status,
    level: row.level,
    score: row.score,
    submissionDate: row.submission_date instanceof Date ? row.submission_date.toISOString() : String(row.submission_date),
  };
}

function ScanCard({ row }: { row: DmoIntegrityRow }) {
  const id = Number(row.submission_id);
  const summary = row.summary;
  const assessment = row.assessment;
  const level = row.status === 'done' ? (row.level ?? 'none') : row.status;
  const levelLabel = row.status === 'done'
    ? DMO_INTEGRITY_LEVELS[(row.level ?? 'none') as DmoIntegrityLevel].label
    : row.status === 'unsupported' ? "Couldn't analyse" : 'Scan failed';
  const inGame = summary?.match.names.filter(Boolean).join(' vs ');
  return (
    <article className={styles.card} data-hidden={row.hidden_at ? 'true' : undefined} id={`match-${id}`}>
      <div className={styles.head}>
        <div>
          <h3 className={styles.title}>
            {dateText(row.submission_date)} · {row.player1} vs {row.player2}
          </h3>
          <div className={styles.meta}>
            {row.tournament} — {row.round_name}
            {summary?.match.finalScore ? ` · ${summary.match.finalScore}` : ''}
            {inGame ? ` · In game: ${inGame}` : ''}
            {row.hidden_at ? ' · Hidden submission' : ''}
          </div>
        </div>
        <span className={styles.level} data-level={level}>{levelLabel}</span>
      </div>

      {row.status !== 'done' && row.error && <p className={styles.error}>{row.error}</p>}

      {summary && assessment && (
        <div className={styles.players}>
          {summary.players.map((player, index) => {
            const own = assessment.players[index];
            return (
              <div className={styles.player} key={index}>
                <div className={styles.playerHead}>
                  <span className={styles.playerName}>{player.name}</span>
                  <span className={styles.level} data-level={own?.level ?? 'none'}>
                    {DMO_INTEGRITY_LEVELS[own?.level ?? 'none'].label}
                  </span>
                </div>
                {own?.reasons.length ? (
                  <ul className={styles.reasons}>
                    {own.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                ) : null}
                {player.flaggedWindows > 0 && (
                  <span className={styles.meta} data-confirmed={player.recordedConfirmedPassages > 0 ? 'true' : undefined}>
                    {player.recordedCheckedPassages === 0
                      ? `No recorded aim was available for any of ${player.flaggedWindows} flagged passages (0 confirmed).`
                      : `Recorded aim confirms ${player.recordedConfirmedPassages} of ${player.flaggedWindows} flagged passages${player.recordedCheckedPassages < player.flaggedWindows ? `; ${player.flaggedWindows - player.recordedCheckedPassages} lacked recorded aim data` : ''}.`}
                  </span>
                )}
                <dl className={styles.numbers}>
                  <dt>Flagged passages (weak · intermediate · converging)</dt>
                  <dd>{player.weakWindows} · {player.intermediateWindows} · {player.convergingWindows}</dd>
                  <dt>Long preparations with repeated short gaps</dt>
                  <dd>{player.repeatedGapPreparations} / {player.longPreparations} ({percent(player.repeatedGapShare)})</dd>
                  <dt>Recorded aim plateaus</dt>
                  <dd>{player.recordedPlateaus}</dd>
                  <dt>Gaps while aiming · while moving</dt>
                  <dd>{player.aimGaps} · {player.moveGaps}</dd>
                  {player.impactMedianCm !== null && (
                    <>
                      <dt>Median lateral aim at impact</dt>
                      <dd>{player.impactMedianCm} cm ({player.impactShots} shots)</dd>
                    </>
                  )}
                </dl>
              </div>
            );
          })}
        </div>
      )}

      {summary && summary.passages.length > 0 && (
        <details>
          <summary>Passages to check in the replay ({summary.passages.length})</summary>
          <ul className={styles.passages}>
            {summary.passages.map((passage, index) => (
              <li key={index}>
                <strong>{GRADE_NAMES[passage.strength] ?? 'Flagged'}</strong>
                {' · '}{summary.players[passage.player]?.name}: point {passage.point} ({passage.score}),{' '}
                {clock(passage.matchTimeSeconds)} into the match
                {passage.intoPointSeconds !== null ? `, ${passage.intoPointSeconds.toFixed(1)} s into the point` : ''}
                {' '}· {passage.methods.join(', ')}
                <br />
                <span className={styles.recorded} data-confirmed={passage.recordedAim?.plateau ? 'true' : undefined}>
                  {recordedAimText(passage.recordedAim)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className={styles.actions}>
        {row.status === 'done' && (
          <a className="btn btn-sm" href={`/api/admin/dmo-integrity/${id}/report`} target="_blank" rel="noreferrer">
            Open full analyzer report
          </a>
        )}
        <a className="btn btn-sm btn-ghost" href={`/api/admin/dmo-submissions/${id}/file`}>
          Download {row.file_name || '.dmo'}
        </a>
        <DmoIntegrityRescanButton id={id} />
        <span className={styles.meta}>
          Scanned {dateText(row.scanned_at)}
          {summary ? ` · Build ${summary.match.build} · ${summary.match.fps} fps · lag ${summary.match.lagFrames} frames` : ''}
        </span>
      </div>
    </article>
  );
}

export default async function AdminDmoIntegrity() {
  const user = await getSession();
  if (!user) redirect('/api/auth/discord');
  if (!user.isAdmin) redirect('/');

  const [rows, pending] = await Promise.all([
    safe(() => listDmoIntegrityScans(500), [] as DmoIntegrityRow[]),
    safe(() => countPendingIntegrityScans(), 0),
  ]);
  const sorted = rows.slice().sort((a, b) => compareIntegrityScans(sortKey(a), sortKey(b)));
  const done = sorted.filter((row) => row.status === 'done');
  const groups = LEVEL_ORDER.map((level) => ({
    level,
    rows: done.filter((row) => (row.level ?? 'none') === level),
  }));
  const unreadable = sorted.filter((row) => row.status !== 'done');

  return (
    <>
      <PageHero eyebrow="Staff" title="Match integrity">
        Submitted DMOs screened with the Online Circuit input analyzer, grouped by its own grades, strongest first. Admins only.
      </PageHero>
      <main className="container">
        <p className="notice warn" style={{ marginBottom: 16 }}>
          These are the analyzer&apos;s own grades for each player&apos;s strongest flagged passage
          outside serves. No grade is proof of cheating: fast tapping, keyboards, worn sticks and
          lag produce the same input patterns. Each passage also says whether the replay&apos;s
          recorded aim confirms it (aim held on a plateau, as a script would); that is shown for
          review and never changes the grade. Watch the passages in the replay and compare both
          players before drawing any conclusion. Review the full report and flagged replay passages
          with the aiming indicator. Keep results within the admin team.
        </p>
        <div className={styles.summaryBar}>
          <div className={styles.counts}>
            {groups.map((group) => (
              <a className={styles.countLink} href={`#level-${group.level}`} key={group.level}>
                <span className={styles.level} data-level={group.level}>{DMO_INTEGRITY_LEVELS[group.level].label}</span>
                <b>{group.rows.length}</b>
              </a>
            ))}
            {unreadable.length > 0 && (
              <a className={styles.countLink} href="#level-unreadable">Couldn&apos;t analyse <b>{unreadable.length}</b></a>
            )}
          </div>
          <DmoIntegrityScanPending pending={pending} />
        </div>

        {groups.map((group) => {
          const content = group.rows.length === 0
            ? <p className="notice">No matches at this level.</p>
            : <div className={styles.list}>{group.rows.map((row) => <ScanCard row={row} key={String(row.submission_id)} />)}</div>;
          const heading = (
            <>
              <span className={styles.level} data-level={group.level}>{DMO_INTEGRITY_LEVELS[group.level].label}</span>
              <span className={styles.meta}>{group.rows.length} match{group.rows.length === 1 ? '' : 'es'}</span>
            </>
          );
          return (
            <section className={styles.section} id={`level-${group.level}`} key={group.level}>
              {group.level === 'none' || group.level === 'weak' ? (
                <details>
                  <summary className={styles.sectionTitle}>{heading}</summary>
                  {content}
                </details>
              ) : (
                <>
                  <h2 className={styles.sectionTitle}>{heading}</h2>
                  {content}
                </>
              )}
            </section>
          );
        })}

        {unreadable.length > 0 && (
          <section className={styles.section} id="level-unreadable">
            <details>
              <summary className={styles.sectionTitle}>
                Couldn&apos;t analyse <span className={styles.meta}>{unreadable.length}</span>
              </summary>
              <p className={styles.meta}>
                The analyzer only reads online singles between two humans from TE4 Builds 167–169
                (replay formats 32–33). It refuses anything it can&apos;t validate, such as other
                builds, resumed matches or incomplete files.
              </p>
              <div className={styles.list}>
                {unreadable.map((row) => <ScanCard row={row} key={String(row.submission_id)} />)}
              </div>
            </details>
          </section>
        )}

        <p className={styles.meta} style={{ marginTop: 24 }}>
          New submissions are scanned automatically. <Link href="/admin/dmo-submissions">Open the DMO store</Link>
        </p>
      </main>
    </>
  );
}
