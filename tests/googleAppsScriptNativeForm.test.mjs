import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../google-apps-script/award-vote-sync.gs', import.meta.url), 'utf8');
const secret = 'script-bridge-secret-for-tests-with-32-chars';
const spreadsheetId = '0123456789abcdefghijklmnopqrstuvwx';

test('Apps Script request limit uses syntax accepted by its editor', () => {
  assert.match(script, /^const MAX_REQUEST_BYTES = 1000000;$/m);
});

function createBridge({
  collectsEmail = false,
  unsupportedRequired = false,
  failFinalFlush = false,
  failSuccessResponse = false,
  releaseLockFails = false,
  failItemResponse = false,
  failSubmit = false,
} = {}) {
  const itemType = {
    MULTIPLE_CHOICE: 'MULTIPLE_CHOICE',
    LIST: 'LIST',
    PAGE_BREAK: 'PAGE_BREAK',
    SECTION_HEADER: 'SECTION_HEADER',
    IMAGE: 'IMAGE',
    VIDEO: 'VIDEO',
    TEXT: 'TEXT',
  };
  let responseSequence = 0;
  let flushCount = 0;
  const rows = [['Timestamp', 'Fans Favourite Award', 'Best Dressed']];
  const items = [
    makeItem(101, 'Fans Favourite Award', itemType.MULTIPLE_CHOICE, true, failItemResponse),
    makeItem(102, 'Best Dressed', itemType.LIST, false),
  ];
  if (unsupportedRequired) {
    items.push(makeItem(103, 'Required text', itemType.TEXT, true));
    rows[0].push('Required text');
  }
  const responses = [];
  const sheet = {
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange(firstRow, firstColumn, rowCount, columnCount) {
      rowCount ??= 1;
      columnCount ??= 1;
      return {
        getDisplayValues() {
          return Array.from({ length: rowCount }, (_, rowOffset) =>
            Array.from({ length: columnCount }, (_, columnOffset) =>
              rows[firstRow - 1 + rowOffset]?.[firstColumn - 1 + columnOffset] ?? '',
            ),
          );
        },
        getValues() {
          return Array.from({ length: rowCount }, (_, rowOffset) =>
            Array.from({ length: columnCount }, (_, columnOffset) =>
              rows[firstRow - 1 + rowOffset]?.[firstColumn - 1 + columnOffset] ?? '',
            ),
          );
        },
        setValue(value) {
          rows[firstRow - 1] ??= [];
          rows[firstRow - 1][firstColumn - 1] = value;
        },
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
    deleteRow(rowNumber) {
      rows.splice(rowNumber - 1, 1);
    },
    hideColumns() {},
  };
  const form = {
    getDestinationId: () => spreadsheetId,
    collectsEmail: () => collectsEmail,
    getItems: () => items,
    getResponses: () => [...responses],
    deleteResponse(responseId) {
      const index = responses.findIndex((response) => response.getId() === responseId);
      if (index >= 0) responses.splice(index, 1);
      // Deliberately does not remove its linked-sheet copy, matching Forms behavior.
    },
    createResponse() {
      const answerByItemId = new Map();
      return {
        withItemResponse(itemResponse) {
          answerByItemId.set(String(itemResponse.item.getId()), itemResponse.answer);
          return this;
        },
        submit() {
          if (failSubmit) throw new Error('private response submission failure');
          for (const item of items) {
            if (item.isRequired() && !answerByItemId.has(String(item.getId()))) {
              throw new Error('Missing required item response');
            }
          }
          responseSequence += 1;
          const timestamp = new Date(Date.UTC(2026, 9, 22, 10, 0, responseSequence));
          const id = `native_response_${responseSequence}`;
          const response = createResponseObject(id, timestamp, items, answerByItemId);
          responses.push(response);
          rows.push([
            new Date(timestamp.getTime() + 500),
            answerByItemId.get('101') ?? '',
            answerByItemId.get('102') ?? '',
          ]);
          return response;
        },
      };
    },
  };
  const spreadsheet = {
    getFormUrl: () => 'https://docs.google.com/forms/d/test-form/edit',
    getSheets: () => [sheet],
  };
  const properties = new Map([
    ['SYNC_SECRET', secret],
    ['SPREADSHEET_ID', spreadsheetId],
  ]);
  let opened = false;
  const context = {
    Date,
    FormApp: {
      ItemType: itemType,
      openByUrl(url) {
        assert.equal(url, 'https://docs.google.com/forms/d/test-form/edit');
        return form;
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties.get(key) ?? null,
        setProperty: (key, value) => properties.set(key, value),
      }),
    },
    SpreadsheetApp: {
      openById(id) {
        opened = true;
        assert.equal(id, spreadsheetId);
        return spreadsheet;
      },
      flush() {
        flushCount += 1;
        if (failFinalFlush && flushCount === 3) throw new Error('private spreadsheet failure');
      },
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() {},
        releaseLock() {
          if (releaseLockFails) throw new Error('private lock failure');
        },
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest(_algorithm, value) {
        return Array.from(createHash('sha256').update(value).digest());
      },
      sleep() {},
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(content) {
        if (failSuccessResponse && content.includes('"ok":true')) {
          throw new Error('private response construction failure');
        }
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
    submitBallot: (formToUse, itemsToUse, ballot) => context.submitBallot(formToUse, itemsToUse, ballot),
    rows,
    responses,
    get opened() { return opened; },
    form,
  };
}

function makeItem(id, title, type, required, failResponseCreation = false) {
  return {
    getId: () => id,
    getTitle: () => title,
    getType: () => type,
    isRequired: () => required,
    asMultipleChoiceItem() {
      return {
        createResponse: (answer) => {
          if (failResponseCreation) throw new Error('private item response failure');
          return { item: this, answer };
        },
      };
    },
    asListItem() {
      return { createResponse: (answer) => ({ item: this, answer }) };
    },
  };
}

function createResponseObject(id, timestamp, items, answerByItemId) {
  return {
    getId: () => id,
    getTimestamp: () => timestamp,
    getResponseForItem(item) {
      if (!answerByItemId.has(String(item.getId()))) return null;
      const answer = answerByItemId.get(String(item.getId()));
      return { getResponse: () => answer };
    },
  };
}

function sampleBallot(overrides = {}) {
  return {
    voterToken: 'a'.repeat(64),
    season: '2026',
    updatedAt: '2026-10-22T10:00:00.000000Z',
    fingerprint: 'b'.repeat(64),
    answers: [
      { questionId: '101', category: 'Fans Favourite Award', answer: 'Dunlop' },
    ],
    ...overrides,
  };
}

function responseBody(response) {
  return JSON.parse(response.content);
}

test('rejects requests without the shared secret before opening the spreadsheet', () => {
  const bridge = createBridge();
  assert.deepEqual(responseBody(bridge.post({ secret: 'wrong', ballots: [sampleBallot()] })), {
    ok: false,
    error: 'unauthorized',
  });
  assert.equal(bridge.opened, false);
});

test('checks an existing managed response without changing the Form or response sheet', () => {
  const bridge = createBridge();
  bridge.post({ secret, ballots: [sampleBallot()] });
  const rowsBefore = JSON.stringify(bridge.rows);
  const responseCountBefore = bridge.responses.length;

  const found = responseBody(bridge.post({
    secret,
    action: 'check-response',
    voterToken: 'a'.repeat(64),
  }));
  assert.deepEqual(found, {
    ok: true,
    result: {
      status: 'found',
      responseId: 'native_response_1',
      fingerprint: 'b'.repeat(64),
      updatedAt: '2026-10-22T10:00:00.000000Z',
    },
  });
  assert.equal(JSON.stringify(bridge.rows), rowsBefore);
  assert.equal(bridge.responses.length, responseCountBefore);

  const missing = responseBody(bridge.post({
    secret,
    action: 'check-response',
    voterToken: 'c'.repeat(64),
  }));
  assert.deepEqual(missing, { ok: true, result: { status: 'not_found' } });
  assert.equal(JSON.stringify(bridge.rows), rowsBefore);
  assert.equal(bridge.responses.length, responseCountBefore);
});

test('submits a native Form response and writes no Forum Votes tab', () => {
  const bridge = createBridge();
  const first = responseBody(bridge.post({ secret, ballots: [sampleBallot()] }));
  assert.equal(first.ok, true);
  assert.equal(first.results[0].status, 'synced');
  assert.equal(first.results[0].responseId, 'native_response_1');
  assert.equal(bridge.responses.length, 1);
  assert.equal(bridge.rows.length, 2);
  assert.deepEqual(bridge.rows[1].slice(1, 3), ['Dunlop', '']);
  assert.equal(bridge.rows[1][3], 'a'.repeat(64));
  assert.equal(bridge.rows[1][4], 'native_response_1');

  const second = responseBody(bridge.post({ secret, ballots: [sampleBallot()] }));
  assert.equal(second.results[0].status, 'unchanged');
  assert.equal(bridge.responses.length, 1);
  assert.equal(bridge.rows.length, 2);
});

test('replaces only that Forum ballot and removes its linked response row', () => {
  const bridge = createBridge();
  const first = responseBody(bridge.post({ secret, ballots: [sampleBallot()] }));
  const editedBallot = sampleBallot({
    updatedAt: '2026-10-22T10:02:00.000000Z',
    fingerprint: 'c'.repeat(64),
    previousResponseId: first.results[0].responseId,
    previousResponseFingerprint: 'b'.repeat(64),
    previousResponseUpdatedAt: '2026-10-22T10:00:00.000000Z',
    answers: [
      { questionId: '101', category: 'Fans Favourite Award', answer: 'Arv' },
      { questionId: '102', category: 'Best Dressed', answer: 'Dunlop' },
    ],
  });

  const updated = responseBody(bridge.post({ secret, ballots: [editedBallot] }));
  assert.equal(updated.results[0].status, 'synced');
  assert.equal(bridge.responses.length, 1);
  assert.equal(bridge.responses[0].getId(), updated.results[0].responseId);
  assert.equal(bridge.rows.length, 2);
  assert.deepEqual(bridge.rows[1].slice(1, 3), ['Arv', 'Dunlop']);
});

test('does not let a delayed older ballot replace the latest response', () => {
  const bridge = createBridge();
  const first = responseBody(bridge.post({ secret, ballots: [sampleBallot()] }));
  const latest = sampleBallot({
    updatedAt: '2026-10-22T10:02:00.000000Z',
    fingerprint: 'c'.repeat(64),
    answers: [{ questionId: '101', category: 'Fans Favourite Award', answer: 'Arv' }],
    previousResponseId: first.results[0].responseId,
  });
  bridge.post({ secret, ballots: [latest] });

  const stale = responseBody(bridge.post({ secret, ballots: [sampleBallot()] }));
  assert.equal(stale.results[0].status, 'stale');
  assert.equal(bridge.responses.length, 1);
  assert.deepEqual(bridge.rows[1].slice(1, 3), ['Arv', '']);
});

test('fails closed for required question types and email collection the Forum cannot answer', () => {
  const emailBridge = createBridge({ collectsEmail: true });
  assert.equal(responseBody(emailBridge.post({ secret, ballots: [sampleBallot()] })).error, 'email_collection_unsupported');
  assert.equal(emailBridge.responses.length, 0);

  const requiredTextBridge = createBridge({ unsupportedRequired: true });
  const result = responseBody(requiredTextBridge.post({ secret, ballots: [sampleBallot()] }));
  assert.equal(result.results[0].status, 'failed');
  assert.equal(result.results[0].errorCode, 'unsupported_required_question');
  assert.equal(requiredTextBridge.responses.length, 0);
});

test('returns fixed diagnostic codes without exposing raw Form error text', () => {
  const ballotBridge = createBridge();
  ballotBridge.form.createResponse = () => {
    throw new Error('private voter answer must not be returned');
  };
  const ballotResult = responseBody(ballotBridge.post({ secret, ballots: [sampleBallot()] }));
  assert.equal(ballotResult.results[0].errorCode, 'form_response_creation_failed');
  assert.equal(JSON.stringify(ballotResult).includes('private voter answer'), false);

  const inspectionBridge = createBridge();
  inspectionBridge.form.getDestinationId = () => {
    throw new Error('private response data must not be returned');
  };
  const inspectionResult = responseBody(inspectionBridge.post({ secret, ballots: [sampleBallot()] }));
  assert.equal(inspectionResult.error, 'form_inspection_failed');
  assert.equal(JSON.stringify(inspectionResult).includes('private response data'), false);
});

test('separates Form answer construction and submission failures without exposing errors', () => {
  const itemBridge = createBridge({ failItemResponse: true });
  const itemResult = responseBody(itemBridge.post({ secret, ballots: [sampleBallot()] }));
  assert.equal(itemResult.results[0].errorCode, 'form_item_response_failed');
  assert.equal(JSON.stringify(itemResult).includes('private item response failure'), false);

  const submitBridge = createBridge({ failSubmit: true });
  const submitResult = responseBody(submitBridge.post({ secret, ballots: [sampleBallot()] }));
  assert.equal(submitResult.results[0].errorCode, 'form_response_submission_failed');
  assert.equal(JSON.stringify(submitResult).includes('private response submission failure'), false);
});

test('uses a safe code for unexpected Form preflight failures', () => {
  const bridge = createBridge();
  let error;
  try {
    bridge.submitBallot(null, [{
      getId() {
        throw new Error('private question metadata');
      },
    }], sampleBallot());
  } catch (caught) {
    error = caught;
  }
  assert.equal(error?.message, 'form_response_preflight_failed');
  assert.equal(error?.message.includes('private'), false);
});

test('distinguishes final flush, response, and lock failures safely', () => {
  const flushBridge = createBridge({ failFinalFlush: true });
  const flushResult = responseBody(flushBridge.post({ secret, ballots: [sampleBallot()] }));
  assert.deepEqual(flushResult, { ok: false, error: 'final_spreadsheet_flush_failed' });
  assert.equal(flushBridge.responses.length, 1);
  const retryResult = responseBody(flushBridge.post({ secret, ballots: [sampleBallot()] }));
  assert.equal(retryResult.ok, true);
  assert.equal(retryResult.results[0].status, 'unchanged');
  assert.equal(flushBridge.responses.length, 1);

  const responseBridge = createBridge({ failSuccessResponse: true });
  const responseResult = responseBody(responseBridge.post({ secret, ballots: [sampleBallot()] }));
  assert.deepEqual(responseResult, { ok: false, error: 'bridge_response_build_failed' });
  assert.equal(JSON.stringify(responseResult).includes('private response'), false);

  const lockBridge = createBridge({ releaseLockFails: true });
  const lockResult = responseBody(lockBridge.post({ secret, ballots: [sampleBallot()] }));
  assert.deepEqual(lockResult, { ok: false, error: 'sync_lock_release_failed' });
  assert.equal(JSON.stringify(lockResult).includes('private lock'), false);
});
