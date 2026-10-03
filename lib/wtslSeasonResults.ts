export type WTSLWtaMatchResult = {
  tour: 'TE4_(F)';
  tournament: string;
  event_category: string;
  date: string;
  round: string;
  result: string;
  p1: string;
  p2: string;
};

const WTA_MATCH_RESULTS_URL =
  'https://www.playwtsl.com/files/download/excel_download.php?download=match_results&game=4&tour=TE4%20(F)';

function parseCsvRecords(value: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < value.length; i += 1) {
    const character = value[i];
    if (quoted) {
      if (character === '"' && value[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      record.push(field);
      field = '';
    } else if (character === '\n') {
      record.push(field.replace(/\r$/, ''));
      if (record.some((cell) => cell !== '')) records.push(record);
      record = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('WTSL WTA match-results CSV has an unterminated quoted field');
  if (field !== '' || record.length > 0) {
    record.push(field.replace(/\r$/, ''));
    if (record.some((cell) => cell !== '')) records.push(record);
  }
  return records;
}

export function parseWTSLWtaMatchResultsCsv(csv: string): WTSLWtaMatchResult[] {
  const records = parseCsvRecords(csv);
  const header = records.shift()?.map((cell, index) => (index === 0 ? cell.replace(/^\uFEFF/, '') : cell).trim());
  if (!header) throw new Error('WTSL WTA match-results CSV is empty');

  const requiredColumns = [
    'Game', 'Tour', 'Player 1', 'Player 2', 'Competition', 'Result', 'Date', 'Tournament', 'Round',
  ];
  const columnIndexes = new Map(header.map((name, index) => [name, index]));
  const missingColumns = requiredColumns.filter((name) => !columnIndexes.has(name));
  if (missingColumns.length > 0) {
    throw new Error('WTSL WTA match-results CSV is missing columns: ' + missingColumns.join(', '));
  }

  const read = (row: string[], column: string) => row[columnIndexes.get(column) ?? -1]?.trim() ?? '';
  const results: WTSLWtaMatchResult[] = [];
  for (const row of records) {
    if (
      !/^Tennis Elbow 4$/i.test(read(row, 'Game'))
      || !/WTA Characters/i.test(read(row, 'Tour'))
      || !/^Singles$/i.test(read(row, 'Competition'))
    ) continue;

    const p1 = read(row, 'Player 1');
    const p2 = read(row, 'Player 2');
    if (!p1 || !p2) continue;
    results.push({
      tour: 'TE4_(F)',
      tournament: read(row, 'Tournament'),
      event_category: read(row, 'Competition'),
      date: read(row, 'Date'),
      round: read(row, 'Round'),
      result: read(row, 'Result'),
      p1,
      p2,
    });
  }
  return results;
}

export async function fetchWTSLWtaMatchResults(): Promise<WTSLWtaMatchResult[]> {
  const response = await fetch(WTA_MATCH_RESULTS_URL, {
    headers: { 'user-agent': 'WTSL-Community-Forum/1.0' },
    next: { revalidate: 300 },
  });
  if (!response.ok) throw new Error('WTSL WTA match-results request failed: ' + response.status);

  const results = parseWTSLWtaMatchResultsCsv(await response.text());
  if (results.length === 0) throw new Error('WTSL WTA match-results file returned no WTA singles rows');
  return results;
}
