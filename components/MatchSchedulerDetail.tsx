'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { CoreMatchSchedulerRecord } from '@/lib/wtsl-core';

type Props = { initialSchedule: CoreMatchSchedulerRecord; viewerDiscordId: string };

function closedStatus(status: string) {
  return ['closed', 'complete', 'completed', 'settled', 'cancelled', 'canceled', 'forfeit'].includes(status.toLowerCase());
}

function displayTime(value: string, timezone?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || 'Not set';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short', ...(timezone ? { timeZone: timezone } : {}) }).format(date);
}

function localDateTimeValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value }).format(new Date());
    return value;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }
}

export default function MatchSchedulerDetail({ initialSchedule, viewerDiscordId }: Props) {
  const router = useRouter();
  const [schedule, setSchedule] = useState(initialSchedule);
  const [slots, setSlots] = useState(['', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [extensionReason, setExtensionReason] = useState('');
  const [proposalFormOpen, setProposalFormOpen] = useState(false);
  const [extensionFormOpen, setExtensionFormOpen] = useState(false);
  const web = schedule.web_scheduler;
  const availability = schedule.availability;
  const extension = web.extension;
  const closed = closedStatus(schedule.status);
  const extensionActive = ['negotiating', 'renegotiating'].includes(extension.status);
  const latestAllowed = extensionActive
    ? extension.latest_allowed_utc
    : schedule.deadline;
  const latestAllowedDate = latestAllowed ? new Date(latestAllowed) : null;
  const proposalWindowOpen = Boolean(
    latestAllowedDate
    && Number.isFinite(latestAllowedDate.getTime())
    && latestAllowedDate.getTime() > Date.now(),
  );
  const canRequestExtension = !closed
    && web.status !== 'confirmed'
    && !extensionActive
    && extension.status !== 'agreed';
  const isProposer = web.proposed_by_user_id != null
    && String(web.proposed_by_user_id) === viewerDiscordId;

  useEffect(() => {
    setTimezone(validTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'));
  }, []);

  useEffect(() => {
    let active = true;
    let pending = false;
    const refreshSchedule = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(
          `/api/match-scheduler?schedule_id=${encodeURIComponent(schedule.schedule_id)}`,
          { cache: 'no-store' },
        );
        if (!response.ok) return;
        const result = await response.json() as { schedule?: CoreMatchSchedulerRecord };
        if (active && result.schedule) {
          setSchedule((current) => {
            const next = result.schedule!;
            if (
              next.web_scheduler.revision < current.web_scheduler.revision
              && next.status === current.status
            ) {
              return current;
            }
            return next;
          });
        }
      } catch {
        // Keep the last confirmed data visible when a background refresh fails.
      } finally {
        pending = false;
      }
    };
    const interval = window.setInterval(() => void refreshSchedule(), 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [schedule.schedule_id]);

  async function sendAction(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/match-scheduler', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || result.message || 'That update could not be saved.');
      if (result.schedule) setSchedule(result.schedule as CoreMatchSchedulerRecord);
      setNotice(result.message || 'Schedule updated.');
      router.refresh();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The scheduler is temporarily unavailable.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function proposeTimes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proposalWindowOpen || !latestAllowedDate) {
      setError('There is no open time window. Request an extension or wait for admins to set a latest time.');
      return;
    }
    const entered = slots.filter(Boolean).map((slot) => new Date(slot)).filter((date) => Number.isFinite(date.getTime()) && date.getTime() > Date.now());
    if (entered.some((date) => date.getTime() > latestAllowedDate.getTime())) {
      setError(`Proposed times must be on or before ${displayTime(latestAllowed, timezone)}.`);
      return;
    }
    const valid = entered.filter((date) => date.getTime() <= latestAllowedDate.getTime());
    const unique = Array.from(new Set(valid.map((date) => date.toISOString())));
    if (unique.length === 0) {
      setError('Add at least one future time option.');
      return;
    }
    const saved = await sendAction({
      action: 'propose',
      schedule_id: schedule.schedule_id,
      slots: unique,
      timezone,
    });
    if (saved) {
      setProposalFormOpen(false);
      setSlots(['', '', '']);
    }
  }

  async function requestExtension(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = extensionReason.trim();
    if (reason.length < 10) {
      setError('Explain why you need more time in at least 10 characters.');
      return;
    }
    const saved = await sendAction({
      action: 'request_extension',
      schedule_id: schedule.schedule_id,
      reason,
    });
    if (saved) {
      setExtensionReason('');
      setExtensionFormOpen(false);
    }
  }

  return (
    <main className="scheduler-page">
      <div className="scheduler-action-row" style={{ marginBottom: 18 }}>
        <Link className="scheduler-inline-link" href="/match-scheduler">Back to your matches</Link>
        <span className={`scheduler-pill ${closed ? '' : web.status === 'confirmed' ? 'scheduler-pill--confirmed' : 'scheduler-pill--pending'}`}>
          {closed ? 'Schedule closed' : extension.status === 'agreed' ? 'Extension agreed' : web.status === 'confirmed' ? 'Time confirmed' : 'Time pending'}
        </span>
      </div>
      <div className="scheduler-detail-layout">
        <section className="scheduler-detail-card" aria-labelledby="schedule-title">
          <div className="scheduler-match-meta"><span>{schedule.tournament}</span><span aria-hidden="true">·</span><span className="scheduler-round">{schedule.round}</span></div>
          <h2 className="scheduler-detail-title" id="schedule-title">Match time</h2>
          <div className="scheduler-detail-opponents">{schedule.players.map((player) => <span className="scheduler-pill" key={player}>{player}</span>)}</div>
          <div className="scheduler-detail-facts">
            <div><small>Match deadline</small><strong>{displayTime(schedule.deadline)}</strong></div>
            <div><small>Scheduling status</small><strong>{closed ? 'Closed' : extension.status === 'agreed' ? 'Extension agreed; admins notified' : web.status === 'confirmed' ? 'Confirmed' : 'Awaiting confirmation'}</strong></div>
          </div>
          {schedule.draw_url && <p><a className="scheduler-inline-link" href={schedule.draw_url} target="_blank" rel="noreferrer">Open official draw</a></p>}

          <div className="scheduler-intro scheduler-intro--invite">
            <strong>Availability</strong>
            {availability.windows.length > 0 ? (
              <>
                <p>
                  Provided by {availability.submitted_by_name || 'the requester'}
                  {availability.timezone ? ` · ${availability.timezone}` : ''}.
                </p>
                <ul className="scheduler-availability-list">
                  {availability.windows.map((window) => (
                    <li key={`${window.start_utc}-${window.end_utc}`}>
                      {displayTime(window.start_utc, availability.timezone)}
                      {' – '}
                      {displayTime(window.end_utc, availability.timezone)}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>None Provided</p>
            )}
          </div>

          {error && <p className="scheduler-error" role="alert">{error}</p>}
          {notice && <p className="scheduler-intro" role="status">{notice}</p>}

          {!closed && extensionActive && (
            <div className="scheduler-intro" role="status" style={{ marginTop: 16 }}>
              <strong>{extension.status === 'renegotiating' ? 'Admins set a revised latest time' : 'Extension request open'}</strong>
              {extension.latest_allowed_utc
                ? <> Propose and agree a time by {displayTime(extension.latest_allowed_utc, timezone)}. Admin approval is not required, but admins may reject the extension.</>
                : <> Admins need to set a latest time before outside-deadline options can be proposed.</>}
              {extension.reason && <p><strong>Reason:</strong> {extension.reason}</p>}
            </div>
          )}
          {!closed && extension.status === 'agreed' && (
            <div className="scheduler-intro" role="status" style={{ marginTop: 16 }}>
              Players agreed to an outside-deadline time. Admins have been notified and may reject it outright or set a revised latest time.
              {extension.reason && <p><strong>Reason:</strong> {extension.reason}</p>}
            </div>
          )}
          {!closed && extension.status === 'rejected' && (
            <div className="scheduler-error" role="status" style={{ marginTop: 16 }}>
              An admin rejected the extension outright. Times beyond the draw deadline are unavailable unless a new extension request is submitted.
              {extension.reason && <p><strong>Request reason:</strong> {extension.reason}</p>}
            </div>
          )}
          {!closed && extension.status === 'withdrawn' && (
            <div className="scheduler-intro" role="status" style={{ marginTop: 16 }}>
              The extension request was withdrawn after the players agreed a time within the draw deadline.
            </div>
          )}

          {!closed && web.status !== 'confirmed' && (
            <div className="scheduler-intro scheduler-intro--invite">
              <strong>Agree on a time together</strong>
              <p>
                Both players have been invited to the private match conversation.
                Discuss availability there; proposing time options is optional.
                Use the button when you are ready to suggest times.
              </p>
              <div className="scheduler-action-row">
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  aria-expanded={proposalFormOpen}
                  aria-controls="scheduler-proposal-form"
                  onClick={() => setProposalFormOpen((open) => !open)}
                  disabled={!proposalWindowOpen}
                >
                  {proposalFormOpen ? 'Cancel proposal' : 'Propose times'}
                </button>
                {canRequestExtension && (
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    aria-expanded={extensionFormOpen}
                    aria-controls="scheduler-extension-form"
                    onClick={() => setExtensionFormOpen((open) => !open)}
                  >
                    {extensionFormOpen ? 'Cancel extension request' : 'Request extension'}
                  </button>
                )}
              </div>
              {!proposalWindowOpen && (
                <p className="muted">
                  The draw deadline has passed. Request an extension to open a
                  new window for proposing times.
                </p>
              )}
            </div>
          )}

          {closed ? (
            <div className="scheduler-empty" style={{ marginTop: 18 }}><strong>This schedule is closed</strong>Time changes are no longer available here. Continue any follow-up in the private Discord conversation.</div>
          ) : web.status === 'confirmed' ? (
            <div className="scheduler-empty" style={{ marginTop: 18 }}>
              <strong>Match time confirmed</strong>
              {displayTime(web.confirmed_slot_utc, timezone)}
              <p>Confirmed by {web.confirmed_by_name || 'a participant'}{web.confirmed_at ? ` · ${displayTime(web.confirmed_at)}` : ''}</p>
            </div>
          ) : (
            <>
              {web.slots_utc.length > 0 && (
                <div style={{ marginTop: 21 }}>
                  <div className="scheduler-heading"><div><h2>Proposed times</h2><p>{web.proposed_by_name || 'A participant'} · entered in {web.timezone || 'UTC'}, shown in your local zone {timezone}</p></div></div>
                  <div className="scheduler-time-list">
                    {web.slots_utc.map((slot) => (
                      <div className="scheduler-time-option" key={slot}>
                        <span>{displayTime(slot, timezone)}</span>
                        {!isProposer && (
                          <button className="btn btn-primary btn-sm" type="button" onClick={() => void sendAction({ action: 'confirm', schedule_id: schedule.schedule_id, slot_utc: slot })} disabled={busy}>
                            {busy ? 'Saving…' : 'Confirm this time'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {isProposer && <p className="muted">Your opponent can confirm one of these options. Keep discussing in the private Discord thread.</p>}
                </div>
              )}
              {proposalFormOpen && (
              <form
                className="scheduler-form"
                id="scheduler-proposal-form"
                style={{ marginTop: 20 }}
                onSubmit={proposeTimes}
              >
                <div>
                  <strong>Propose times</strong>
                  <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                    Times are sent as UTC and shown using your local zone: {timezone}.
                    {proposalWindowOpen && latestAllowed ? ` Latest allowed: ${displayTime(latestAllowed, timezone)}.` : ''}
                  </p>
                </div>
                <div className="scheduler-slot-grid">
                  {slots.map((slot, index) => (
                    <label key={index}>Option {index + 1}
                      <input
                        type="datetime-local"
                        min={localDateTimeValue(new Date(Date.now() + 60_000).toISOString())}
                        max={latestAllowed ? localDateTimeValue(latestAllowed) : undefined}
                        value={slot}
                        onChange={(event) => setSlots((current) => current.map((value, i) => i === index ? event.target.value : value))}
                      />
                    </label>
                  ))}
                </div>
                <div className="scheduler-action-row">
                  <button className="btn btn-primary" type="submit" disabled={busy || !proposalWindowOpen}>{busy ? 'Sending…' : 'Send time options'}</button>
                </div>
              </form>
              )}
              {canRequestExtension && extensionFormOpen && (
                <form
                  className="scheduler-form"
                  id="scheduler-extension-form"
                  style={{ marginTop: 20 }}
                  onSubmit={requestExtension}
                >
                  <div>
                    <strong>{extension.status === 'rejected' ? 'Request another extension' : 'Need more time?'}</strong>
                    <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                      The usual extension window ends two days after the draw deadline. You can agree a time without waiting for approval; admins are notified and may reject the extension.
                    </p>
                  </div>
                  <label>
                    Reason for the extension
                    <textarea
                      value={extensionReason}
                      onChange={(event) => setExtensionReason(event.target.value)}
                      minLength={10}
                      maxLength={500}
                      required
                      rows={3}
                      placeholder="Explain why you need more time"
                    />
                  </label>
                  <div className="scheduler-action-row">
                    <button className="btn btn-ghost" type="submit" disabled={busy}>
                      {busy ? 'Sending…' : 'Request extension'}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </section>

        <aside className="scheduler-stack">
          <div className="scheduler-discord-note">
            <strong>Discord stays central</strong>
            Use the private match conversation to talk through availability and details. This page refreshes the shared schedule automatically, so either participant can propose or confirm here.
            {schedule.thread_url && <p><a className="scheduler-inline-link" href={schedule.thread_url} target="_blank" rel="noreferrer">Open private Discord thread</a></p>}
          </div>
          <div className="scheduler-detail-card">
            <div className="scheduler-heading"><div><h2>Participants</h2><p>Only these players can coordinate this match.</p></div></div>
            {schedule.players.map((player, index) => <div className="scheduler-match" key={player} style={{ marginTop: 9, padding: 12 }}><span className="scheduler-pill">{index === 0 ? 'Player 1' : 'Player 2'}</span><strong>{player}</strong></div>)}
          </div>
        </aside>
      </div>
    </main>
  );
}
