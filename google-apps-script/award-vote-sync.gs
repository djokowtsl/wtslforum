const SHEET_NAME = 'Forum Votes';
const HEADERS = ['Forum vote ID', 'Season', 'Award category', 'Nominee', 'Write-in', 'Last updated (UTC)'];
const MAX_VOTES_PER_REQUEST = 100;
const MAX_REQUEST_BYTES = 1_000_000;

function doPost(event) {
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

    const votes = normalizeVotes(payload.votes);
    if (!votes || votes.length < 1 || votes.length > MAX_VOTES_PER_REQUEST) {
      return jsonResponse({ ok: false, error: 'invalid_votes' });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      let sheet = spreadsheet.getSheetByName(SHEET_NAME);
      if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);
      ensureHeaders(sheet);
      const result = upsertVotes(sheet, votes);
      SpreadsheetApp.flush();
      return jsonResponse({ ok: true, ...result });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error('[Awards vote sync] Spreadsheet operation failed.');
    return jsonResponse({ ok: false, error: 'sync_failed' });
  }
}

function normalizeVotes(values) {
  if (!Array.isArray(values)) return null;
  const byId = new Map();
  for (const value of values) {
    if (!value || typeof value !== 'object') return null;
    const voteId = String(value.voteId || '').trim();
    const season = plainText(value.season, 40);
    const category = plainText(value.category, 200);
    const nominee = plainText(value.nominee, 300);
    const writeIn = plainText(value.writeIn, 300);
    const castAt = String(value.castAt || '').trim();
    if (
      !/^\d{1,20}$/.test(voteId)
      || season === null
      || !season
      || category === null
      || !category
      || nominee === null
      || writeIn === null
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(castAt)
      || Number.isNaN(Date.parse(castAt))
    ) {
      return null;
    }
    const existing = byId.get(voteId);
    if (!existing || castAt >= existing.castAt) {
      byId.set(voteId, { voteId, season, category, nominee, writeIn, castAt });
    }
  }
  return Array.from(byId.values());
}

function plainText(value, maxLength) {
  if (value == null) return '';
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length <= maxLength ? text : null;
}

function ensureHeaders(sheet) {
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
  if (current.every((value) => !value)) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    return;
  }
  if (!HEADERS.every((header, index) => current[index] === header)) {
    throw new Error('The Forum Votes tab has unexpected headers.');
  }
}

function upsertVotes(sheet, votes) {
  const lastRow = sheet.getLastRow();
  const rowByVoteId = new Map();
  if (lastRow > 1) {
    const existingRows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getDisplayValues();
    existingRows.forEach((row, index) => {
      const voteId = String(row[0] || '').trim();
      if (voteId) rowByVoteId.set(voteId, { row: index + 2, castAt: String(row[5] || '') });
    });
  }

  const updates = [];
  const additions = [];
  let ignored = 0;
  for (const vote of votes) {
    const row = [
      vote.voteId,
      vote.season,
      vote.category,
      vote.nominee,
      vote.writeIn,
      vote.castAt,
    ].map(asSafeCellText);
    const existing = rowByVoteId.get(vote.voteId);
    if (existing) {
      if (existing.castAt && vote.castAt < existing.castAt) {
        ignored += 1;
        continue;
      }
      updates.push({ row: existing.row, values: row });
      rowByVoteId.set(vote.voteId, { row: existing.row, castAt: vote.castAt });
    } else {
      additions.push(row);
      rowByVoteId.set(vote.voteId, { row: lastRow + additions.length, castAt: vote.castAt });
    }
  }

  updates.sort((left, right) => left.row - right.row);
  let updateStart = null;
  let updateRows = [];
  for (const update of updates) {
    if (updateStart !== null && update.row !== updateStart + updateRows.length) {
      writeRows(sheet, updateStart, updateRows);
      updateStart = null;
      updateRows = [];
    }
    if (updateStart === null) updateStart = update.row;
    updateRows.push(update.values);
  }
  if (updateStart !== null) writeRows(sheet, updateStart, updateRows);

  if (additions.length) writeRows(sheet, sheet.getLastRow() + 1, additions);
  return { inserted: additions.length, updated: updates.length, ignored };
}

function writeRows(sheet, firstRow, rows) {
  const range = sheet.getRange(firstRow, 1, rows.length, HEADERS.length);
  range.setNumberFormat('@');
  range.setValues(rows);
}

function asSafeCellText(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
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
