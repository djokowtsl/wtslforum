'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CoreMatchSchedulerOpenMatch, CoreMatchSchedulerRecord, CoreMatchSchedulerState } from '@/lib/wtsl-core';

type Props = { state: CoreMatchSchedulerState; highlightedTournament?: string; highlightedMatch?: string };

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function localDateTimeValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function MatchCard({ match, highlighted }: { match: CoreMatchSchedulerOpenMatch; highlighted: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [availabilityPromptOpen, setAvailabilityPromptOpen] = useState(false);
  const [availabilityWindows, setAvailabilityWindows] = useState([{ start: '', end: '' }]);
  const schedule = match.schedule;

  async function createSchedule(skipAvailability = false) {
    let windows: { start_utc: string; end_utc: string }[] = [];
    if (!skipAvailability) {
      const entered = availabilityWindows.filter((window) => window.start || window.end);
      if (entered.some((window) => !window.start || !window.end)) {
        setError('Enter both a start and end for each availability window.');
        return;
      }
      for (const window of entered) {
        const start = new Date(window.start);
        const end = new Date(window.end);
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
          setError('Enter valid start and end times.');
          return;
        }
        if (start.getTime() <= Date.now()) {
          setError('Availability windows must start in the future.');
          return;
        }
        if (end.getTime() - start.getTime() < 3 * 60 * 60 * 1000) {
          setError('Each availability window must be at least 3 hours.');
          return;
        }
        windows.push({
          start_utc: start.toISOString(),
          end_utc: end.toISOString(),
        });
      }
      if (windows.length === 0) {
        setError('Add a window or choose “Skip for now.”');
        return;
      }
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/match-scheduler', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          tournament_id: match.tournament_id,
          match_id: match.match_id,
          availability_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          availability_windows: windows,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || result.message || 'Could not open a schedule. Try again.');
      if (result.schedule?.schedule_id) {
        router.push(`/match-scheduler/${encodeURIComponent(result.schedule.schedule_id)}`);
        return;
      }
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The scheduler is temporarily unavailable.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="scheduler-match" id={highlighted ? 'selected-match' : undefined}>
      <div className="scheduler-match-main">
        <div className="scheduler-match-meta">
          <span>{match.tournament}</span><span aria-hidden="true">·</span><span className="scheduler-round">{match.round}</span>
          {highlighted && <span className="scheduler-pill scheduler-pill--pending">Selected from Discord</span>}
        </div>
        <h3>{match.players.join('  vs  ')}</h3>
        <div className="scheduler-match-sub">Official draw match · match {match.match_id} · deadline {dateLabel(match.deadline)}</div>
        {error && <p className="scheduler-error" role="alert">{error}</p>}
      </div>
      <div className="scheduler-match-actions">
        {match.opponent_verified && <span className="scheduler-pill scheduler-pill--verified">Both verified</span>}
        {!match.opponent_verified && <span className="scheduler-pill">Opponent verification pending</span>}
        {schedule ? (
          <Link className="btn btn-primary btn-sm" href={`/match-scheduler/${encodeURIComponent(schedule.schedule_id)}`}>
            Open schedule
          </Link>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() => {
              setError('');
              setAvailabilityPromptOpen(true);
            }}
            disabled={busy || !match.opponent_verified}
          >
            {match.opponent_verified ? 'Schedule this match' : 'Waiting for verification'}
          </button>
        )}
        {match.draw_url && <a className="btn btn-ghost btn-sm" href={match.draw_url} target="_blank" rel="noreferrer">View draw</a>}
      </div>
      {!schedule && availabilityPromptOpen && (
        <form
          className="scheduler-form scheduler-availability-prompt"
          onSubmit={(event) => {
            event.preventDefault();
            void createSchedule();
          }}
        >
          <div>
            <strong>Share your availability</strong>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
              Optional. Each window must be at least 3 hours and uses your
              device’s local time. Leave it blank and choose “Skip for now” to
              continue with <em>Availability: None Provided</em>.
            </p>
          </div>
          {availabilityWindows.map((window, index) => (
            <div className="scheduler-availability-window" key={index}>
              <label>
                Window {index + 1} start
                <input
                  type="datetime-local"
                  min={localDateTimeValue(new Date(Date.now() + 60_000).toISOString())}
                  value={window.start}
                  onChange={(event) => setAvailabilityWindows((current) =>
                    current.map((item, itemIndex) => itemIndex === index
                      ? { ...item, start: event.target.value }
                      : item))}
                />
              </label>
              <label>
                End
                <input
                  type="datetime-local"
                  min={window.start || localDateTimeValue(new Date(Date.now() + 60_000).toISOString())}
                  value={window.end}
                  onChange={(event) => setAvailabilityWindows((current) =>
                    current.map((item, itemIndex) => itemIndex === index
                      ? { ...item, end: event.target.value }
                      : item))}
                />
              </label>
              {availabilityWindows.length > 1 && (
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  aria-label={`Remove availability window ${index + 1}`}
                  onClick={() => setAvailabilityWindows((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index))}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {availabilityWindows.length < 5 && (
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => setAvailabilityWindows((current) => [
                ...current,
                { start: '', end: '' },
              ])}
            >
              Add another window
            </button>
          )}
          <div className="scheduler-action-row">
            <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>
              {busy ? 'Opening…' : 'Create schedule'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => void createSchedule(true)}
              disabled={busy}
            >
              {busy ? 'Opening…' : 'Skip for now'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => setAvailabilityPromptOpen(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

function ScheduleCard({ schedule }: { schedule: CoreMatchSchedulerRecord }) {
  const web = schedule.web_scheduler;
  const extension = web.extension;
  const closed = ['closed', 'complete', 'completed', 'settled', 'cancelled', 'canceled', 'forfeit'].includes(schedule.status.toLowerCase());
  const summary = closed
    ? 'Schedule closed'
    : extension.status === 'agreed'
      ? `Extension agreed · ${dateLabel(extension.agreed_slot_utc)}`
      : extension.status === 'renegotiating'
        ? `New latest time · ${dateLabel(extension.latest_allowed_utc)}`
        : extension.status === 'negotiating'
          ? `Extension requested · latest ${dateLabel(extension.latest_allowed_utc)}`
          : extension.status === 'rejected'
            ? 'Extension rejected'
            : web.status === 'confirmed'
              ? `Confirmed · ${dateLabel(web.confirmed_slot_utc)}`
              : web.slots_utc.length
                ? `${web.slots_utc.length} time${web.slots_utc.length === 1 ? '' : 's'} proposed`
                : 'Waiting for a time proposal';
  return (
    <article className="scheduler-match">
      <div className="scheduler-match-main">
        <div className="scheduler-match-meta"><span>{schedule.tournament}</span><span aria-hidden="true">·</span><span className="scheduler-round">{schedule.round}</span></div>
        <h3>{schedule.players.join('  vs  ')}</h3>
        <div className="scheduler-match-sub">
          {summary}
        </div>
      </div>
      <div className="scheduler-match-actions">
        <span className={`scheduler-pill ${closed ? '' : web.status === 'confirmed' ? 'scheduler-pill--confirmed' : 'scheduler-pill--pending'}`}>
          {closed ? 'Closed' : web.status === 'confirmed' ? 'Confirmed' : 'Pending'}
        </span>
        <Link className="btn btn-sm" href={`/match-scheduler/${encodeURIComponent(schedule.schedule_id)}`}>View details</Link>
      </div>
    </article>
  );
}

export default function MatchSchedulerBoard({ state, highlightedTournament, highlightedMatch }: Props) {
  const [filter, setFilter] = useState('');
  const activeSchedules = state.schedules.filter((schedule) =>
    !['closed', 'complete', 'completed', 'settled', 'cancelled', 'canceled', 'forfeit'].includes(schedule.status.toLowerCase()),
  );
  const matches = state.matches.filter((match) =>
    !filter || `${match.tournament} ${match.round} ${match.players.join(' ')}`.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <main className="scheduler-page">
      <div className="scheduler-intro">
        <span className="scheduler-pill scheduler-pill--verified">Official draw</span>
        <div><strong>Coordinate here. Keep the conversation in Discord.</strong> Propose a few options, then confirm the agreed time in this schedule. Your private match thread remains the place for discussion.</div>
      </div>

      {state.verified ? (
        <>
          <section className="scheduler-section" aria-labelledby="open-matches-heading">
            <div className="scheduler-heading">
              <div><h2 id="open-matches-heading">Your draw matches</h2><p>Official WTSL matches available to schedule.</p></div>
              <span className="scheduler-count">{matches.length} available</span>
            </div>
            {state.matches.length > 4 && (
              <label className="scheduler-form" style={{ marginBottom: 12 }}>
                <span>Find a match</span>
                <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Tournament, round or player" />
              </label>
            )}
            {state.matches.length === 0 ? (
              <div className="scheduler-empty"><strong>No open draw matches right now</strong>When a new official WTSL draw match is ready, it will appear here.</div>
            ) : matches.length === 0 ? (
              <div className="scheduler-empty"><strong>No matches found</strong>Try another tournament, round or player name.</div>
            ) : (
              <div className="scheduler-match-list">
                {matches.map((match) => (
                  <MatchCard
                    key={`${match.tournament_id}-${match.match_id}`}
                    match={match}
                    highlighted={Boolean(highlightedTournament && highlightedMatch && match.tournament_id === highlightedTournament && match.match_id === highlightedMatch)}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="scheduler-section" aria-labelledby="active-schedules-heading">
            <div className="scheduler-heading">
              <div><h2 id="active-schedules-heading">Active schedules</h2><p>Proposals and confirmed times for your matches.</p></div>
              <span className="scheduler-count">{activeSchedules.length} active</span>
            </div>
            {activeSchedules.length === 0 ? (
              <div className="scheduler-empty"><strong>No schedules started</strong>Choose an open draw match above to begin coordinating a time.</div>
            ) : (
              <div className="scheduler-match-list">{activeSchedules.map((schedule) => <ScheduleCard key={schedule.schedule_id} schedule={schedule} />)}</div>
            )}
          </section>
        </>
      ) : (
        <section className="scheduler-section scheduler-empty" aria-live="polite">
          <strong>Your Forum account is not linked to a verified WTSL player</strong>
          Match scheduling is available to verified players. Link your player profile from your account settings, then return here.
          <div><Link className="btn btn-primary btn-sm" href="/profile">Open your profile</Link></div>
        </section>
      )}
    </main>
  );
}
