import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../google-apps-script/award-vote-sync.gs', import.meta.url), 'utf8');
const secret = 'script-bridge-secret-for-tests-with-32-chars';
const spreadsheetId = '0123456789abcdefghijklmnopqrstuvwx';

function createBridge() {
  const rows = [];
  let created = false;
  const sheet = {
    getLastRow() {
      return rows.length;
    },
    getRange(firstRow, firstColumn, rowCount, columnCount) {
      return {
        getDisplayValues() {
          return Array.from({ length: rowCount }, (_, rowOffset) =>
            Array.from({ length: columnCount }, (_, columnOffset) =>
              rows[firstRow - 1 + rowOffset]?.[firstColumn - 1 + columnOffset] ?? '',
            ),
          );
        },
        setNumberFormat() {},
        setValues(values) {
          values.forEach((valuesRow, rowOffset) => {
            const rowIndex = firstRow - 1 + rowOffset;
            rows[rowIndex] ??= [];
            valuesRow.forEach((value, columnOffset) => {
              rows[rowIndex][firstColumn - 1 + columnOffset] = value;
            });
          });
        },
      };
    },
  };
  const spreadsheet = {
    getSheetByName(name) {
      return name === 'Forum Votes' && created ? sheet : null;
    },
    insertSheet(name) {
      assert.equal(name, 'Forum Votes');
      created = true;
      return sheet;
    },
  };
  const context = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => ({ SYNC_SECRET: secret, SPREADSHEET_ID: spreadsheetId })[key] ?? null,
      }),
    },
    SpreadsheetApp: {
      openById: (id) => {
        assert.equal(id, spreadsheetId);
        return spreadsheet;
      },
      flush() {},
    },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(content) {
        return {
          content,
          setMimeType() { return this; },
        };
      },
    },
    console: { error() {} },
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  return {
    post: (payload) => context.doPost({ postData: { contents: JSON.stringify(payload) } }),
    rows,
    get created() { return created; },
  };
}

function sampleVote(overrides = {}) {
  return {
    voteId: '101',
    season: '2026',
    category: 'Fans Favourite Award',
    nominee: 'Dunlop',
    writeIn: null,
    castAt: '2026-10-22T10:00:00.000000Z',
    ...overrides,
  };
}

function responseBody(response) {
  return JSON.parse(response.content);
}

test('rejects requests without the shared secret before opening the spreadsheet', () => {
  const bridge = createBridge();
  assert.deepEqual(responseBody(bridge.post({ secret: 'wrong', votes: [sampleVote()] })), {
    ok: false,
    error: 'unauthorized',
  });
  assert.equal(bridge.created, false);
});

test('upserts by stable vote ID and keeps formula-like names as text', () => {
  const bridge = createBridge();
  const inserted = responseBody(bridge.post({ secret, votes: [sampleVote({ nominee: '=SUM(1,2)' })] }));
  assert.deepEqual(inserted, { ok: true, inserted: 1, updated: 0, ignored: 0 });
  assert.equal(bridge.rows.length, 2);
  assert.equal(bridge.rows[1][3], "'=SUM(1,2)");

  const updated = responseBody(bridge.post({ secret, votes: [sampleVote({ nominee: 'New nominee' })] }));
  assert.deepEqual(updated, { ok: true, inserted: 0, updated: 1, ignored: 0 });
  assert.equal(bridge.rows.length, 2);
  assert.equal(bridge.rows[1][3], 'New nominee');
});

test('does not let a delayed older vote overwrite a newer row', () => {
  const bridge = createBridge();
  bridge.post({ secret, votes: [sampleVote({ nominee: 'Latest nominee', castAt: '2026-10-22T10:00:00.000002Z' })] });

  const stale = responseBody(bridge.post({
    secret,
    votes: [sampleVote({ nominee: 'Stale nominee', castAt: '2026-10-22T10:00:00.000001Z' })],
  }));
  assert.deepEqual(stale, { ok: true, inserted: 0, updated: 0, ignored: 1 });
  assert.equal(bridge.rows[1][3], 'Latest nominee');
});

test('does not overwrite an existing tab with unexpected headers', () => {
  const bridge = createBridge();
  const original = bridge.post({ secret, votes: [sampleVote()] });
  assert.equal(responseBody(original).ok, true);
  bridge.rows[0][0] = 'Other sheet data';

  const response = responseBody(bridge.post({ secret, votes: [sampleVote({ voteId: '102' })] }));
  assert.deepEqual(response, { ok: false, error: 'sync_failed' });
  assert.equal(bridge.rows.length, 2);
});
