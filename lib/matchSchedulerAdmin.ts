import {
  wtslCore,
  type CoreMatchSchedulerAvailabilityWindow,
  type CoreMatchSchedulerRecord,
  type CoreMatchSchedulerStoredRecord,
  type CoreMatchSchedulerWebState,
} from './wtsl-core';

type Data = Record<string, unknown>;

function asData(value: unknown): Data {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Data;
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Data
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

function isoDate(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (typeof value !== 'string' || !value.trim()) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function safeHttpsUrl(value: unknown): string {
  const raw = text(value).trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function safeWindows(value: unknown, limit = 5): CoreMatchSchedulerAvailabilityWindow[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).flatMap((item) => {
    const window = asData(item);
    const start = isoDate(window.start_utc);
    const end = isoDate(window.end_utc);
    if (!start || !end || Date.parse(end) <= Date.parse(start)) return [];
    return [{ start_utc: start, end_utc: end }];
  });
}

function extensionStatus(value: unknown): CoreMatchSchedulerWebState['extension']['status'] {
  const status = text(value);
  return ['negotiating', 'renegotiating', 'agreed', 'rejected', 'withdrawn'].includes(status)
    ? status as CoreMatchSchedulerWebState['extension']['status']
    : 'none';
}

function safeRevision(value: unknown): number {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

export function serializeAdminMatchSchedule(
  value: CoreMatchSchedulerStoredRecord | unknown,
): CoreMatchSchedulerRecord | null {
  const record = asData(value);
  const scheduleId = text(record.schedule_id);
  if (
    record.is_test === true
    || !/^MS-[A-Z0-9-]{5,40}$/.test(scheduleId)
  ) {
    return null;
  }

  const metadata = asData(record.metadata);
  const initialAvailability = asData(metadata.initial_availability);
  const webState = asData(metadata.web_scheduler);
  const extension = asData(webState.extension);
  const playerOneId = text(record.player_one_user_id);
  const playerTwoId = text(record.player_two_user_id);
  const rawAvailability = asData(webState.availability_windows_by_user);
  const availabilityByUser: NonNullable<CoreMatchSchedulerWebState['availability_by_user']> = {};

  for (const [userId, proposalValue] of Object.entries(rawAvailability)) {
    const playerKey = userId === playerOneId
      ? 'player-1'
      : userId === playerTwoId
        ? 'player-2'
        : '';
    if (!playerKey) continue;
    const proposal = asData(proposalValue);
    const windows = safeWindows(proposal.windows);
    if (!windows.length) continue;
    availabilityByUser[playerKey] = {
      submitted_by_name: text(proposal.submitted_by_name)
        || (playerKey === 'player-1' ? text(record.player_one) : text(record.player_two)),
      submitted_at: isoDate(proposal.submitted_at),
      timezone: text(proposal.timezone) || 'UTC',
      windows,
    };
  }

  const slots = Array.isArray(webState.slots_utc)
    ? webState.slots_utc.slice(0, 3).map(isoDate).filter(Boolean)
    : [];
  const extensionState: CoreMatchSchedulerWebState['extension'] = {
    status: extensionStatus(extension.status),
    requested_by_user_id: null,
    requested_by_name: text(extension.requested_by_name),
    requested_at: isoDate(extension.requested_at),
    reason: text(extension.reason),
    latest_allowed_utc: isoDate(extension.latest_allowed_utc),
    agreed_slot_utc: isoDate(extension.agreed_slot_utc),
    agreed_by_user_id: null,
    agreed_by_name: text(extension.agreed_by_name),
    agreed_at: isoDate(extension.agreed_at),
    rejected_at: isoDate(extension.rejected_at),
    rejected_by_user_id: null,
    rejected_by_name: text(extension.rejected_by_name),
    rejection_note: text(extension.rejection_note),
    revision: safeRevision(extension.revision),
  };

  const webScheduler: CoreMatchSchedulerWebState = {
    status: webState.status === 'confirmed' ? 'confirmed' : 'pending',
    proposed_by_user_id: null,
    proposed_by_name: text(webState.proposed_by_name),
    proposed_at: isoDate(webState.proposed_at),
    timezone: text(webState.timezone) || 'UTC',
    slots_utc: slots,
    availability_by_user: availabilityByUser,
    confirmed_slot_utc: isoDate(webState.confirmed_slot_utc),
    confirmed_by_user_id: null,
    confirmed_by_name: text(webState.confirmed_by_name),
    confirmed_at: isoDate(webState.confirmed_at),
    revision: safeRevision(webState.revision),
    extension: extensionState,
  };

  const deadline = isoDate(metadata.deadline_at);
  const createdAt = isoDate(record.created_at);
  return {
    schedule_id: scheduleId,
    tournament_id: text(record.tournament_id),
    tournament: text(record.tournament_name) || 'WTSL',
    round: text(record.round_name),
    match_id: text(record.source_match_id),
    players: [text(record.player_one), text(record.player_two)],
    status: text(record.status),
    deadline,
    draw_url: safeHttpsUrl(metadata.draw_url),
    // Admins see schedule data only; private Discord thread access remains unchanged.
    thread_url: '',
    web_url: `/match-scheduler/${encodeURIComponent(scheduleId)}`,
    created_at: createdAt,
    availability: {
      submitted_by_name: text(initialAvailability.submitted_by_name),
      timezone: text(initialAvailability.timezone) || 'UTC',
      windows: safeWindows(initialAvailability.windows),
    },
    web_scheduler: webScheduler,
  };
}

export async function getAdminMatchSchedules(): Promise<CoreMatchSchedulerRecord[]> {
  const storedSchedules = await wtslCore.matchSchedules();
  return storedSchedules
    .map(serializeAdminMatchSchedule)
    .filter((schedule): schedule is CoreMatchSchedulerRecord => Boolean(schedule))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export async function getAdminMatchSchedule(
  scheduleId: string,
): Promise<CoreMatchSchedulerRecord | null> {
  const schedules = await getAdminMatchSchedules();
  return schedules.find((schedule) => schedule.schedule_id === scheduleId) ?? null;
}
