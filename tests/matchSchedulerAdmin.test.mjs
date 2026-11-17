import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function loadModule(path, mocks) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript', tsx: path.endsWith('.tsx') }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'React', code)((name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('node:')) return require(name);
    throw new Error(`Unexpected module dependency: ${name}`);
  }, module, module.exports, React);
  return module.exports;
}

const jsxRuntime = {
  Fragment: Symbol.for('react.fragment'),
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
};

function rawSchedule(overrides = {}) {
  return {
    schedule_id: 'MS-TEST-ABC123',
    tournament_id: 'tournament-1',
    tournament_name: 'Orleans',
    round_name: 'Quarter-final',
    source_match_id: 'match-4',
    player_one: 'Player One',
    player_two: 'Player Two',
    player_one_user_id: 12345,
    player_two_user_id: 67890,
    thread_id: 98765,
    status: 'active',
    is_test: false,
    created_at: '2026-11-17T12:00:00Z',
    metadata: {
      deadline_at: '2026-11-20T12:00:00Z',
      draw_url: 'https://draw.example.test/orleans',
      initial_availability: {
        submitted_by_name: 'Player One',
        timezone: 'Europe/London',
        windows: [{
          start_utc: '2026-11-18T10:00:00Z',
          end_utc: '2026-11-18T14:00:00Z',
        }],
      },
      web_scheduler: {
        status: 'pending',
        proposed_by_user_id: 12345,
        proposed_by_name: 'Player One',
        proposed_at: '2026-11-17T13:00:00Z',
        timezone: 'Europe/London',
        slots_utc: ['2026-11-18T11:00:00Z'],
        availability_windows_by_user: {
          '12345': {
            submitted_by_name: 'Player One',
            submitted_at: '2026-11-17T12:30:00Z',
            timezone: 'Europe/London',
            windows: [{
              start_utc: '2026-11-18T10:00:00Z',
              end_utc: '2026-11-18T14:00:00Z',
            }],
          },
          '67890': {
            submitted_by_name: 'Player Two',
            submitted_at: '2026-11-17T12:45:00Z',
            timezone: 'UTC',
            windows: [{
              start_utc: '2026-11-18T11:00:00Z',
              end_utc: '2026-11-18T15:00:00Z',
            }],
          },
          '99999': {
            submitted_by_name: 'Unexpected user',
            windows: [{
              start_utc: '2026-11-18T11:00:00Z',
              end_utc: '2026-11-18T15:00:00Z',
            }],
          },
        },
        confirmed_by_user_id: 67890,
        confirmed_by_name: 'Player Two',
        confirmed_at: '',
        revision: 2,
        extension: {
          status: 'negotiating',
          requested_by_user_id: 12345,
          requested_by_name: 'Player One',
          requested_at: '2026-11-17T13:00:00Z',
          reason: 'Need another day to coordinate.',
          latest_allowed_utc: '2026-11-22T12:00:00Z',
          revision: 1,
        },
      },
    },
    ...overrides,
  };
}

test('admin schedule serialization omits private identifiers and test fixtures', () => {
  const { serializeAdminMatchSchedule } = loadModule('lib/matchSchedulerAdmin.ts', {
    './wtsl-core': { wtslCore: { matchSchedules: async () => [] } },
  });
  const schedule = serializeAdminMatchSchedule(rawSchedule());

  assert.ok(schedule);
  assert.deepEqual(schedule.players, ['Player One', 'Player Two']);
  assert.equal(schedule.thread_url, '');
  assert.equal(schedule.web_scheduler.proposed_by_user_id, null);
  assert.equal(schedule.web_scheduler.confirmed_by_user_id, null);
  assert.equal(schedule.web_scheduler.extension.requested_by_user_id, null);
  assert.deepEqual(Object.keys(schedule.web_scheduler.availability_by_user), ['player-1', 'player-2']);
  assert.equal(schedule.web_scheduler.availability_by_user['player-1'].submitted_by_name, 'Player One');
  assert.equal(schedule.web_scheduler.availability_by_user['player-2'].windows.length, 1);
  assert.equal(JSON.stringify(schedule).includes('12345'), false);
  assert.equal(JSON.stringify(schedule).includes('67890'), false);
  assert.equal(JSON.stringify(schedule).includes('98765'), false);
  assert.equal(serializeAdminMatchSchedule(rawSchedule({ is_test: true })), null);
  assert.equal(serializeAdminMatchSchedule(rawSchedule({ schedule_id: 'invalid' })), null);
});

test('admin schedule helpers return newest real schedules and support detail lookup', async () => {
  const { getAdminMatchSchedules, getAdminMatchSchedule } = loadModule('lib/matchSchedulerAdmin.ts', {
    './wtsl-core': {
      wtslCore: {
        matchSchedules: async () => [
          rawSchedule({ schedule_id: 'MS-TEST-OLDER1', created_at: '2026-11-15T12:00:00Z' }),
          rawSchedule({ schedule_id: 'MS-TEST-NEWER1', created_at: '2026-11-18T12:00:00Z' }),
          rawSchedule({ schedule_id: 'MS-TEST-FIXTURE', is_test: true }),
        ],
      },
    },
  });

  const schedules = await getAdminMatchSchedules();
  assert.deepEqual(schedules.map((schedule) => schedule.schedule_id), [
    'MS-TEST-NEWER1',
    'MS-TEST-OLDER1',
  ]);
  assert.equal((await getAdminMatchSchedule('MS-TEST-OLDER1')).schedule_id, 'MS-TEST-OLDER1');
  assert.equal(await getAdminMatchSchedule('MS-TEST-MISSING'), null);
});

test('admin schedule list page rejects non-admins before loading all schedules', async () => {
  let listLoads = 0;
  const page = loadModule('app/admin/match-scheduler/page.tsx', {
    'next/navigation': {
      redirect: (path) => { throw new Error(`redirect:${path}`); },
    },
    '@/components/AdminMatchSchedulerList': {},
    '@/components/PageHero': {},
    '@/lib/auth': { getSession: async () => ({ isAdmin: false }) },
    '@/lib/matchSchedulerAdmin': {
      getAdminMatchSchedules: async () => {
        listLoads += 1;
        return [];
      },
    },
    'react/jsx-runtime': jsxRuntime,
  });

  await assert.rejects(page.default(), /redirect:\/$/);
  assert.equal(listLoads, 0);
});

test('admins can open direct schedule links in read-only mode', async () => {
  const schedule = { schedule_id: 'MS-TEST-ABC123' };
  const scheduleDetail = () => null;
  let lookedUpId = '';
  const page = loadModule('app/match-scheduler/[scheduleId]/page.tsx', {
    'next/link': () => null,
    '@/components/PageHero': () => null,
    '@/components/MatchSchedulerDetail': scheduleDetail,
    '@/lib/auth': { getSession: async () => ({ discordId: 'admin-42', isAdmin: true }) },
    '@/lib/wtsl-core': {
      wtslCore: {
        matchSchedulerDetail: async () => { throw new Error('not a participant'); },
      },
    },
    '@/lib/matchSchedulerAdmin': {
      getAdminMatchSchedule: async (scheduleId) => {
        lookedUpId = scheduleId;
        return schedule;
      },
    },
    'react/jsx-runtime': jsxRuntime,
  });

  const result = await page.default({ params: Promise.resolve({ scheduleId: schedule.schedule_id }) });
  const detail = result.props.children.find((child) => child.type === scheduleDetail);
  assert.equal(lookedUpId, schedule.schedule_id);
  assert.ok(detail);
  assert.equal(detail.props.initialSchedule, schedule);
  assert.equal(detail.props.viewerDiscordId, 'admin-42');
  assert.equal(detail.props.readOnly, true);
});

test('non-admin direct links never use the admin schedule fallback', async () => {
  let adminLookups = 0;
  const page = loadModule('app/match-scheduler/[scheduleId]/page.tsx', {
    'next/link': () => null,
    '@/components/PageHero': () => null,
    '@/components/MatchSchedulerDetail': () => null,
    '@/lib/auth': { getSession: async () => ({ discordId: 'member-7', isAdmin: false }) },
    '@/lib/wtsl-core': {
      wtslCore: {
        matchSchedulerDetail: async () => { throw new Error('not a participant'); },
      },
    },
    '@/lib/matchSchedulerAdmin': {
      getAdminMatchSchedule: async () => {
        adminLookups += 1;
        return { schedule_id: 'MS-TEST-ABC123' };
      },
    },
    'react/jsx-runtime': jsxRuntime,
  });

  const result = await page.default({ params: Promise.resolve({ scheduleId: 'MS-TEST-ABC123' }) });
  assert.equal(adminLookups, 0);
  assert.equal(result.type, jsxRuntime.Fragment);
});

test('read-only schedule detail shows availability but renders no actions', () => {
  const { serializeAdminMatchSchedule } = loadModule('lib/matchSchedulerAdmin.ts', {
    './wtsl-core': { wtslCore: { matchSchedules: async () => [] } },
  });
  const Link = ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children);
  const detail = loadModule('components/MatchSchedulerDetail.tsx', {
    'next/link': Link,
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
  }).default;
  const schedule = serializeAdminMatchSchedule(rawSchedule());
  const html = renderToStaticMarkup(React.createElement(detail, {
    initialSchedule: schedule,
    viewerDiscordId: 'admin-42',
    readOnly: true,
  }));

  assert.match(html, /Read-only staff view/);
  assert.match(html, /Shared availability · Player One/);
  assert.equal((html.match(/<button\b/g) ?? []).length, 0);
  assert.equal(html.includes('Open private Discord thread'), false);
});
