'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { CoreMatchSchedulerRecord } from '@/lib/wtsl-core';

type Props = { schedules: CoreMatchSchedulerRecord[] };
type StatusFilter = 'all' | 'active' | 'closed';

function dateLabel(value: string) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function isClosed(schedule: CoreMatchSchedulerRecord) {
  return schedule.status.toLowerCase() !== 'active';
}

function summary(schedule: CoreMatchSchedulerRecord) {
  const { extension } = schedule.web_scheduler;
  if (isClosed(schedule)) return `Schedule ${schedule.status || 'closed'}`;
  if (extension.status === 'agreed') return `Extension agreed · ${dateLabel(extension.agreed_slot_utc)}`;
  if (extension.status === 'renegotiating') return `Revised latest time · ${dateLabel(extension.latest_allowed_utc)}`;
  if (extension.status === 'negotiating') return `Extension requested · latest ${dateLabel(extension.latest_allowed_utc)}`;
  if (extension.status === 'rejected') return 'Extension rejected';
  if (schedule.web_scheduler.status === 'confirmed') {
    return `Confirmed · ${dateLabel(schedule.web_scheduler.confirmed_slot_utc)}`;
  }
  if (schedule.web_scheduler.slots_utc.length) {
    return `${schedule.web_scheduler.slots_utc.length} time${schedule.web_scheduler.slots_utc.length === 1 ? '' : 's'} proposed`;
  }
  return 'Waiting for a time proposal';
}

export default function AdminMatchSchedulerList({ schedules }: Props) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return schedules.filter((schedule) => {
      if (statusFilter === 'active' && isClosed(schedule)) return false;
      if (statusFilter === 'closed' && !isClosed(schedule)) return false;
      if (!needle) return true;
      return [
        schedule.schedule_id,
        schedule.tournament,
        schedule.round,
        schedule.match_id,
        ...schedule.players,
        schedule.status,
      ].join(' ').toLocaleLowerCase().includes(needle);
    });
  }, [query, schedules, statusFilter]);

  return (
    <main className="scheduler-page">
      <div className="scheduler-intro">
        <span className="scheduler-pill">Read-only</span>
        <div><strong>All real match schedules</strong>Review availability, proposals, confirmations, and extension status. Staff access does not include player actions.</div>
      </div>
      <div className="scheduler-action-row" style={{ marginBottom: 16 }}>
        <label className="scheduler-form" style={{ flex: '1 1 280px', margin: 0 }}>
          <span>Find a schedule</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Player, tournament, round, or ID"
          />
        </label>
        <label className="scheduler-form" style={{ flex: '0 1 190px', margin: 0 }}>
          <span>Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="all">All schedules</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
          </select>
        </label>
      </div>
      <section className="scheduler-section" aria-labelledby="admin-schedules-heading">
        <div className="scheduler-heading">
          <div><h2 id="admin-schedules-heading">Match schedules</h2><p>Open any real schedule for a read-only staff view.</p></div>
          <span className="scheduler-count">{filtered.length} shown</span>
        </div>
        {filtered.length === 0 ? (
          <div className="scheduler-empty"><strong>No schedules found</strong>Try a different status or search term.</div>
        ) : (
          <div className="scheduler-match-list">
            {filtered.map((schedule) => (
              <article className="scheduler-match" key={schedule.schedule_id}>
                <div className="scheduler-match-main">
                  <div className="scheduler-match-meta">
                    <span>{schedule.tournament}</span><span aria-hidden="true">·</span>
                    <span className="scheduler-round">{schedule.round || 'Round unavailable'}</span>
                  </div>
                  <h3>{schedule.players.join('  vs  ')}</h3>
                  <div className="scheduler-match-sub">
                    {summary(schedule)} · created {dateLabel(schedule.created_at)}
                  </div>
                </div>
                <div className="scheduler-match-actions">
                  <span className={`scheduler-pill ${isClosed(schedule) ? '' : schedule.web_scheduler.status === 'confirmed' ? 'scheduler-pill--confirmed' : 'scheduler-pill--pending'}`}>
                    {isClosed(schedule) ? 'Closed' : schedule.web_scheduler.status === 'confirmed' ? 'Confirmed' : 'Pending'}
                  </span>
                  <Link className="btn btn-sm" href={`/match-scheduler/${encodeURIComponent(schedule.schedule_id)}`}>
                    View schedule
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
