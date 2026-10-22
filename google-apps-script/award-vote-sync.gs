const MAX_BALLOTS_PER_REQUEST = 20;
const MAX_QUESTIONS = 40;
const MAX_REQUEST_BYTES = 1000000;
const RESPONSE_TIMESTAMP_MATCH_WINDOW_MS = 2000;
const SYNC_HEADERS = {
  voterToken: '__Forum voter token__',
  responseId: '__Forum response ID__',
  fingerprint: '__Forum ballot fingerprint__',
  updatedAt: '__Forum ballot updated at__',
};
const SAFE_SYNC_ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'misconfigured',
  'invalid_ballots',
  'missing_linked_form',
  'linked_form_lookup_failed',
  'unexpected_form_destination',
  'email_collection_unsupported',
  'sync_lock_failed',
  'spreadsheet_access_failed',
  'form_access_failed',
  'form_inspection_failed',
  'response_sheet_not_found_or_ambiguous',
  'response_sheet_setup_failed',
  'previous_response_missing',
  'previous_response_row_missing',
  'incomplete_response_metadata',
  'unmatched_or_unsupported_question',
  'unsupported_required_question',
  'missing_required_answer',
  'form_response_preflight_failed',
  'form_response_creation_failed',
  'form_item_response_failed',
  'form_response_submission_failed',
  'form_response_failed',
  'new_response_row_missing',
  'response_metadata_write_failed',
  'ballot_batch_execution_failed',
  'final_spreadsheet_flush_failed',
  'bridge_response_build_failed',
  'sync_lock_release_failed',
  'ballot_sync_failed',
  'sync_failed',
];

function safeSyncErrorCode(error, fallback) {
  const message = error && typeof error.message === 'string' ? error.message : '';
  return SAFE_SYNC_ERROR_CODES.indexOf(message) >= 0 ? message : fallback;
}

function doPost(event) {
  let failureCode = 'invalid_request';
  try {
    const bodyText = event && event.postData && event.postData.contents;
    if (!bodyText || bodyText.length > MAX_REQUEST_BYTES) return jsonResponse({ ok: false, error: 'invalid_request' });

    const payload = JSON.parse(bodyText);
    const properties = PropertiesService.getScriptProperties();
    const expectedSecret = properties.getProperty('SYNC_SECRET') || '';
    const spreadsheetId = properties.getProperty('SPREADSHEET_ID') || '';
    if (!constantTimeEquals(expectedSecret, String(payload.secret || ''))) {
      return jsonResponse({ ok: false, error: 'unauthorized' });
    }
    if (!/^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId)) {
      return jsonResponse({ ok: false, error: 'misconfigured' });
    }

    const action = payload.action || 'sync';
    if (action === 'check-response') {
      const voterToken = String(payload.voterToken || '').trim();
      if (!/^[a-f0-9]{64}$/.test(voterToken)) {
        return jsonResponse({ ok: false, error: 'invalid_request' });
      }
      return checkManagedResponse(spreadsheetId, voterToken);
    }
    if (action !== 'sync') return jsonResponse({ ok: false, error: 'invalid_request' });

    const ballots = normalizeBallots(payload.ballots);
    if (!ballots || ballots.length < 1 || ballots.length > MAX_BALLOTS_PER_REQUEST) {
      return jsonResponse({ ok: false, error: 'invalid_ballots' });
    }

    failureCode = 'sync_lock_failed';
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      failureCode = 'spreadsheet_access_failed';
      const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      failureCode = 'linked_form_lookup_failed';
      const formUrl = spreadsheet.getFormUrl();
      if (!formUrl) return jsonResponse({ ok: false, error: 'missing_linked_form' });

      failureCode = 'form_access_failed';
      const form = FormApp.openByUrl(formUrl);
      failureCode = 'form_inspection_failed';
      if (form.getDestinationId() !== spreadsheetId) {
        return jsonResponse({ ok: false, error: 'unexpected_form_destination' });
      }
      if (form.collectsEmail()) {
        return jsonResponse({ ok: false, error: 'email_collection_unsupported' });
      }

      const items = getResponseItems(form);
      failureCode = 'response_sheet_setup_failed';
      const responseSheet = findResponseSheet(spreadsheet, items);
      failureCode = 'ballot_batch_execution_failed';
      const results = ballots.map((ballot) => {
        try {
          return syncBallot(form, responseSheet, items, ballot);
        } catch (error) {
          const errorCode = safeSyncErrorCode(error, 'ballot_sync_failed');
          console.error('[Awards Form sync] ballot_failed:' + errorCode);
          return {
            voterToken: ballot.voterToken,
            status: 'failed',
            responseId: '',
            fingerprint: ballot.fingerprint,
            updatedAt: ballot.updatedAt,
            errorCode: errorCode,
          };
        }
      });
      failureCode = 'final_spreadsheet_flush_failed';
      SpreadsheetApp.flush();
      failureCode = 'bridge_response_build_failed';
      return jsonResponse({ ok: true, results: results });
    } finally {
      try {
        lock.releaseLock();
      } catch (_releaseError) {
        throw new Error('sync_lock_release_failed');
      }
    }
  } catch (error) {
    const errorCode = safeSyncErrorCode(error, failureCode);
    console.error('[Awards Form sync] ' + errorCode);
    return jsonResponse({ ok: false, error: errorCode });
  }
}

function checkManagedResponse(spreadsheetId, voterToken) {
  let failureCode = 'sync_lock_failed';
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    failureCode = 'spreadsheet_access_failed';
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    failureCode = 'linked_form_lookup_failed';
    const formUrl = spreadsheet.getFormUrl();
    if (!formUrl) return jsonResponse({ ok: false, error: 'missing_linked_form' });

    failureCode = 'form_access_failed';
    const form = FormApp.openByUrl(formUrl);
    if (form.getDestinationId() !== spreadsheetId || form.collectsEmail()) {
      return jsonResponse({ ok: false, error: 'form_access_failed' });
    }
    const items = getResponseItems(form);
    failureCode = 'response_sheet_setup_failed';
    const responseSheet = findResponseSheet(spreadsheet, items, false);
    if (!responseSheet.metadataColumns) {
      return jsonResponse({ ok: true, result: { status: 'unverifiable' } });
    }

    const managedRows = findManagedRows(responseSheet, voterToken);
    if (!managedRows.length) {
      return jsonResponse({ ok: true, result: { status: 'not_found' } });
    }
    if (managedRows.length !== 1) {
      return jsonResponse({ ok: true, result: { status: 'ambiguous' } });
    }

    const receipt = managedRows[0];
    if (
      !/^[A-Za-z0-9_-]{1,200}$/.test(receipt.responseId)
      || !/^[a-f0-9]{64}$/.test(receipt.fingerprint)
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(receipt.updatedAt)
    ) {
      return jsonResponse({ ok: true, result: { status: 'unverifiable' } });
    }
    const responseExists = form.getResponses().some((response) => String(response.getId()) === receipt.responseId);
    if (!responseExists) {
      return jsonResponse({ ok: true, result: { status: 'response_missing' } });
    }
    return jsonResponse({
      ok: true,
      result: {
        status: 'found',
        responseId: receipt.responseId,
        fingerprint: receipt.fingerprint,
        updatedAt: receipt.updatedAt,
      },
    });
  } catch (error) {
    const errorCode = safeSyncErrorCode(error, failureCode);
    console.error('[Awards Form response check] ' + errorCode);
    return jsonResponse({ ok: false, error: errorCode });
  } finally {
    try {
      lock.releaseLock();
    } catch (_releaseError) {
      console.error('[Awards Form response check] sync_lock_release_failed');
    }
  }
}

function normalizeBallots(values) {
  if (!Array.isArray(values)) return null;
  const seen = new Set();
  const ballots = [];

  for (const value of values) {
    if (!value || typeof value !== 'object') return null;
    const voterToken = String(value.voterToken || '').trim();
    const season = plainText(value.season, 40);
    const updatedAt = String(value.updatedAt || '').trim();
    const fingerprint = String(value.fingerprint || '').trim();
    const previousResponseId = value.previousResponseId == null ? '' : String(value.previousResponseId).trim();
    const previousResponseFingerprint = value.previousResponseFingerprint == null ? '' : String(value.previousResponseFingerprint).trim();
    const previousResponseUpdatedAt = value.previousResponseUpdatedAt == null ? '' : String(value.previousResponseUpdatedAt).trim();
    if (
      !/^[a-f0-9]{64}$/.test(voterToken)
      || season === null
      || !season
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(updatedAt)
      || Number.isNaN(Date.parse(updatedAt))
      || !/^[a-f0-9]{64}$/.test(fingerprint)
      || (previousResponseId && !/^[A-Za-z0-9_-]{1,200}$/.test(previousResponseId))
      || (previousResponseFingerprint && !/^[a-f0-9]{64}$/.test(previousResponseFingerprint))
      || (previousResponseUpdatedAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(previousResponseUpdatedAt))
      || !Array.isArray(value.answers)
      || value.answers.length < 1
      || value.answers.length > MAX_QUESTIONS
    ) {
      return null;
    }

    const answers = value.answers.map((answer) => ({
      category: plainText(answer && answer.category, 200),
      answer: plainText(answer && answer.answer, 300),
      questionId: answer && answer.questionId == null ? '' : plainText(answer && answer.questionId, 100),
    }));
    if (answers.some((answer) =>
      answer.category === null
      || !answer.category
      || answer.answer === null
      || !answer.answer
      || answer.questionId === null
      || (answer.questionId && !/^[A-Za-z0-9_-]+$/.test(answer.questionId))
    )) return null;
    if (new Set(answers.map((answer) => answer.category.toLocaleLowerCase())).size !== answers.length) return null;

    const key = season + ':' + voterToken;
    if (seen.has(key)) return null;
    seen.add(key);
    ballots.push({
      voterToken: voterToken,
      season: season,
      updatedAt: updatedAt,
      fingerprint: fingerprint,
      previousResponseId: previousResponseId,
      previousResponseFingerprint: previousResponseFingerprint,
      previousResponseUpdatedAt: previousResponseUpdatedAt,
      answers: answers.sort((left, right) => left.category.localeCompare(right.category)),
    });
  }

  return ballots;
}

function syncBallot(form, responseSheet, items, ballot) {
  let managedRows = findManagedRows(responseSheet, ballot.voterToken);
  let current = reconcileManagedRows(form, responseSheet, managedRows);

  if (!current && ballot.previousResponseId) {
    const priorResponse = findFormResponse(form, ballot.previousResponseId);
    if (!priorResponse) throw new Error('previous_response_missing');
    const priorRow = findRowByResponse(responseSheet, items, priorResponse);
    if (!priorRow) throw new Error('previous_response_row_missing');
    writeSyncMetadata(responseSheet, priorRow.rowNumber, {
      voterToken: ballot.voterToken,
      responseId: ballot.previousResponseId,
      fingerprint: ballot.previousResponseFingerprint,
      updatedAt: ballot.previousResponseUpdatedAt || ballot.updatedAt,
    });
    current = {
      voterToken: ballot.voterToken,
      responseId: ballot.previousResponseId,
      fingerprint: ballot.previousResponseFingerprint,
      updatedAt: ballot.previousResponseUpdatedAt || ballot.updatedAt,
      rowNumber: priorRow.rowNumber,
    };
  }

  if (current && ballot.updatedAt < current.updatedAt) {
    return ballotResult(ballot, 'stale', current.responseId, current.fingerprint, current.updatedAt);
  }
  if (current && ballot.fingerprint === current.fingerprint) {
    return ballotResult(ballot, 'unchanged', current.responseId, current.fingerprint, current.updatedAt);
  }

  let newResponse;
  try {
    newResponse = submitBallot(form, items, ballot);
  } catch (error) {
    throw new Error(safeSyncErrorCode(error, 'form_response_failed'));
  }
  SpreadsheetApp.flush();
  const newRow = findRowByResponseWithRetry(responseSheet, items, newResponse);
  if (!newRow) {
    form.deleteResponse(newResponse.getId());
    throw new Error('new_response_row_missing');
  }

  const next = {
    voterToken: ballot.voterToken,
    responseId: String(newResponse.getId() || ''),
    fingerprint: ballot.fingerprint,
    updatedAt: ballot.updatedAt,
    rowNumber: newRow.rowNumber,
  };
  try {
    writeSyncMetadata(responseSheet, newRow.rowNumber, next);
  } catch (_error) {
    try {
      form.deleteResponse(next.responseId);
      const untrackedRow = findRowByResponse(responseSheet, items, newResponse);
      if (untrackedRow) responseSheet.sheet.deleteRow(untrackedRow.rowNumber);
    } catch (_cleanupError) {
      console.error('[Awards Form sync] Could not roll back an untracked response.');
    }
    throw new Error('response_metadata_write_failed');
  }

  if (current && current.responseId !== next.responseId) {
    deleteManagedResponse(form, responseSheet, current.responseId);
  }
  return ballotResult(ballot, 'synced', next.responseId, next.fingerprint, next.updatedAt);
}

function reconcileManagedRows(form, responseSheet, rows) {
  if (!rows.length) return null;
  if (rows.some((row) => !row.responseId || !row.fingerprint || !row.updatedAt)) {
    throw new Error('incomplete_response_metadata');
  }
  rows.sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) return left.updatedAt.localeCompare(right.updatedAt);
    return left.rowNumber - right.rowNumber;
  });
  const current = rows[rows.length - 1];
  for (const old of rows.slice(0, -1)) {
    deleteManagedResponse(form, responseSheet, old.responseId);
  }
  return current;
}

function deleteManagedResponse(form, responseSheet, responseId) {
  if (findFormResponse(form, responseId)) {
    form.deleteResponse(responseId);
  }
  SpreadsheetApp.flush();
  const rowNumber = findRowByResponseId(responseSheet, responseId);
  if (rowNumber) responseSheet.sheet.deleteRow(rowNumber);
}

function ballotResult(ballot, status, responseId, fingerprint, updatedAt) {
  return {
    voterToken: ballot.voterToken,
    status: status,
    responseId: responseId,
    fingerprint: fingerprint,
    updatedAt: updatedAt,
  };
}

function submitBallot(form, items, ballot) {
  let answersByCategory;
  let answerByQuestionId;
  try {
    answersByCategory = new Map(ballot.answers.map((answer) => [answer.category, answer.answer]));
    answerByQuestionId = new Map(ballot.answers.filter((answer) => answer.questionId).map((answer) => [answer.questionId, answer.answer]));
    const itemByTitle = new Map();
    const itemById = new Map(items.map((item) => [String(item.getId()), item]));
    for (const item of items) {
      const title = String(item.getTitle() || '').trim();
      if (!itemByTitle.has(title)) itemByTitle.set(title, []);
      itemByTitle.get(title).push(item);
    }

    for (const answer of ballot.answers) {
      const matches = getMatchingItems(answer, itemByTitle, itemById);
      if (matches.length !== 1 || !isSupportedChoiceItem(matches[0])) {
        throw new Error('unmatched_or_unsupported_question');
      }
    }
    for (const item of items) {
      const required = isRequiredResponseItem(item);
      if (required && !isSupportedChoiceItem(item)) {
        throw new Error('unsupported_required_question');
      }
      const title = String(item.getTitle() || '').trim();
      const answer = answerByQuestionId.has(String(item.getId()))
        ? answerByQuestionId.get(String(item.getId()))
        : answersByCategory.get(title);
      if (required && !answer) {
        throw new Error('missing_required_answer');
      }
    }
  } catch (error) {
    throw new Error(safeSyncErrorCode(error, 'form_response_preflight_failed'));
  }

  let response;
  try {
    response = form.createResponse();
  } catch (error) {
    throw new Error(safeSyncErrorCode(error, 'form_response_creation_failed'));
  }
  try {
    for (const item of items) {
      const title = String(item.getTitle() || '').trim();
      const answer = answerByQuestionId.has(String(item.getId()))
        ? answerByQuestionId.get(String(item.getId()))
        : answersByCategory.get(title);
      if (!answer) continue;
      const itemResponse = item.getType() === FormApp.ItemType.MULTIPLE_CHOICE
        ? item.asMultipleChoiceItem().createResponse(answer)
        : item.asListItem().createResponse(answer);
      response = response.withItemResponse(itemResponse);
    }
  } catch (error) {
    throw new Error(safeSyncErrorCode(error, 'form_item_response_failed'));
  }
  try {
    return response.submit();
  } catch (error) {
    throw new Error(safeSyncErrorCode(error, 'form_response_submission_failed'));
  }
}

function getMatchingItems(answer, itemByTitle, itemById) {
  if (answer.questionId && itemById.has(answer.questionId)) return [itemById.get(answer.questionId)];
  return itemByTitle.get(answer.category) || [];
}

function isSupportedChoiceItem(item) {
  const type = item.getType();
  return type === FormApp.ItemType.MULTIPLE_CHOICE || type === FormApp.ItemType.LIST;
}

function isRequiredResponseItem(item) {
  // Form.getItems() returns generic Item objects, which have no isRequired().
  // Only the type-specific question interface exposes the required flag.
  const castMethods = {
    CHECKBOX: 'asCheckboxItem',
    CHECKBOX_GRID: 'asCheckboxGridItem',
    DATE: 'asDateItem',
    DATETIME: 'asDateTimeItem',
    DURATION: 'asDurationItem',
    GRID: 'asGridItem',
    LIST: 'asListItem',
    MULTIPLE_CHOICE: 'asMultipleChoiceItem',
    PARAGRAPH_TEXT: 'asParagraphTextItem',
    RATING: 'asRatingItem',
    SCALE: 'asScaleItem',
    TEXT: 'asTextItem',
    TIME: 'asTimeItem',
  };
  const castMethod = castMethods[String(item.getType())];
  if (!castMethod || typeof item[castMethod] !== 'function') {
    throw new Error('unsupported_required_question');
  }
  const question = item[castMethod]();
  if (!question || typeof question.isRequired !== 'function') {
    throw new Error('form_inspection_failed');
  }
  return question.isRequired();
}

function getResponseItems(form) {
  const decorativeTypes = [
    FormApp.ItemType.PAGE_BREAK,
    FormApp.ItemType.SECTION_HEADER,
    FormApp.ItemType.IMAGE,
    FormApp.ItemType.VIDEO,
  ];
  return form.getItems().filter((item) => decorativeTypes.indexOf(item.getType()) === -1);
}

function findResponseSheet(spreadsheet, items, createSyncColumns = true) {
  const candidates = [];
  for (const sheet of spreadsheet.getSheets()) {
    const columnCount = sheet.getLastColumn();
    if (columnCount < 1 || sheet.getLastRow() < 1) continue;
    const headers = sheet.getRange(1, 1, 1, columnCount).getDisplayValues()[0];
    if (headers[0] !== 'Timestamp') continue;

    const itemColumns = [];
    let searchFrom = 1;
    let matches = true;
    for (const item of items) {
      const title = String(item.getTitle() || '').trim();
      let found = -1;
      for (let index = searchFrom; index < headers.length; index += 1) {
        if (headers[index] === title) {
          found = index + 1;
          break;
        }
      }
      if (found < 0) {
        matches = false;
        break;
      }
      itemColumns.push(found);
      searchFrom = found;
    }
    if (matches) candidates.push({ sheet: sheet, itemColumns: itemColumns });
  }
  if (candidates.length !== 1) throw new Error('response_sheet_not_found_or_ambiguous');
  const responseSheet = candidates[0];
  responseSheet.columnCount = responseSheet.sheet.getLastColumn();
  responseSheet.metadataColumns = createSyncColumns
    ? ensureSyncColumns(responseSheet.sheet)
    : readSyncColumns(responseSheet.sheet);
  responseSheet.columnCount = responseSheet.sheet.getLastColumn();
  return responseSheet;
}

function readSyncColumns(sheet) {
  const columnCount = sheet.getLastColumn();
  if (columnCount < 1) return null;
  const headers = sheet.getRange(1, 1, 1, columnCount).getDisplayValues()[0];
  const columns = {};
  for (const [key, header] of Object.entries(SYNC_HEADERS)) {
    const column = headers.indexOf(header) + 1;
    if (!column) return null;
    columns[key] = column;
  }
  return columns;
}

function ensureSyncColumns(sheet) {
  let columnCount = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, columnCount).getDisplayValues()[0];
  const columns = {};
  for (const [key, header] of Object.entries(SYNC_HEADERS)) {
    let column = headers.indexOf(header) + 1;
    if (!column) {
      column = columnCount + 1;
      sheet.getRange(1, column).setValue(header);
      columnCount = column;
      headers.push(header);
    }
    columns[key] = column;
    try {
      sheet.hideColumns(column);
    } catch (_error) {
      // The values remain private sync metadata even if the sheet cannot hide the column.
    }
  }
  return columns;
}

function findManagedRows(responseSheet, voterToken) {
  const sheet = responseSheet.sheet;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const rows = sheet.getRange(2, 1, lastRow - 1, responseSheet.columnCount).getValues();
  return rows.flatMap((row, index) => {
    if (String(row[responseSheet.metadataColumns.voterToken - 1] || '') !== voterToken) return [];
    return [{
      voterToken: voterToken,
      responseId: String(row[responseSheet.metadataColumns.responseId - 1] || ''),
      fingerprint: String(row[responseSheet.metadataColumns.fingerprint - 1] || ''),
      updatedAt: String(row[responseSheet.metadataColumns.updatedAt - 1] || ''),
      rowNumber: index + 2,
    }];
  });
}

function writeSyncMetadata(responseSheet, rowNumber, receipt) {
  const columns = responseSheet.metadataColumns;
  responseSheet.sheet.getRange(rowNumber, columns.voterToken).setValue(receipt.voterToken);
  responseSheet.sheet.getRange(rowNumber, columns.responseId).setValue(receipt.responseId);
  responseSheet.sheet.getRange(rowNumber, columns.fingerprint).setValue(receipt.fingerprint);
  responseSheet.sheet.getRange(rowNumber, columns.updatedAt).setValue(receipt.updatedAt);
  SpreadsheetApp.flush();
}

function findRowByResponseId(responseSheet, responseId) {
  const sheet = responseSheet.sheet;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(2, responseSheet.metadataColumns.responseId, lastRow - 1, 1).getDisplayValues();
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (String(values[index][0] || '') === responseId) return index + 2;
  }
  return null;
}

function findRowByResponseWithRetry(responseSheet, items, response) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = findRowByResponse(responseSheet, items, response, RESPONSE_TIMESTAMP_MATCH_WINDOW_MS);
    if (row) return row;
    Utilities.sleep(250);
  }
  return null;
}

function findRowByResponse(responseSheet, items, response, timestampToleranceMs = 0) {
  const timestamp = response.getTimestamp();
  if (!(timestamp instanceof Date)) return null;
  const expectedAnswers = items.map((item) => responseAnswer(response, item));
  const sheet = responseSheet.sheet;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const rows = sheet.getRange(2, 1, lastRow - 1, responseSheet.columnCount).getValues();
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!(row[0] instanceof Date) || Math.abs(row[0].getTime() - timestamp.getTime()) > timestampToleranceMs) continue;
    if (expectedAnswers.every((answer, itemIndex) =>
      normalizeCell(row[responseSheet.itemColumns[itemIndex] - 1]) === answer
    )) {
      return { rowNumber: index + 2, values: row };
    }
  }
  return null;
}

function responseAnswer(response, item) {
  const itemResponse = response.getResponseForItem(item);
  if (!itemResponse) return '';
  const value = itemResponse.getResponse();
  if (Array.isArray(value)) return value.map((part) => String(part)).join(', ');
  return normalizeCell(value);
}

function findFormResponse(form, responseId) {
  return form.getResponses().find((response) => String(response.getId() || '') === responseId) || null;
}

function plainText(value, maxLength) {
  if (value == null) return '';
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length <= maxLength ? text : null;
}

function normalizeCell(value) {
  return value == null ? '' : String(value);
}

function constantTimeEquals(expected, actual) {
  if (!expected || expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
