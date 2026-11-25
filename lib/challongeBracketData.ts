export type BracketSide = 'winners' | 'losers' | 'main';
export type BracketMatchStatus = 'open' | 'pending' | 'complete';

export type BracketMatch = {
  matchId: string;
  number: string;
  team1: string;
  team2: string;
  team1Seed: string | null;
  team2Seed: string | null;
  status: BracketMatchStatus;
  winner: 1 | 2 | null;
  scores: [string | null, string | null];
  x: number;
  y: number;
};

export type BracketRound = {
  key: string;
  name: string;
  bestOf: string | null;
  x: number;
  sectionY: number;
  matches: BracketMatch[];
};

export type BracketSection = {
  index: number;
  offsetY: number;
  side: BracketSide;
};

export type BracketConnector = {
  x: number;
  y: number;
  path: string;
};

export type TournamentBracketData = {
  winners: BracketRound[];
  losers: BracketRound[];
  main: BracketRound[];
  width: number;
  height: number;
  sections: BracketSection[];
  connectors: BracketConnector[];
};

type XmlElement = {
  name: string;
  attributes: Record<string, string>;
  content: Array<XmlElement | string>;
};

const MAX_SVG_LENGTH = 2_000_000;

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const point = Number.parseInt(hex, 16);
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/&#(\d+);/g, (_match, decimal: string) => {
      const point = Number.parseInt(decimal, 10);
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseXml(svg: string): XmlElement {
  if (svg.length > MAX_SVG_LENGTH) {
    throw new Error('Challonge SVG is too large to render.');
  }

  const document: XmlElement = { name: '#document', attributes: {}, content: [] };
  const stack = [document];
  const tokens = svg.match(
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g,
  ) ?? [];

  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<?') || /^<!DOCTYPE/i.test(token)) {
      continue;
    }
    if (token.startsWith('<![CDATA[')) {
      stack[stack.length - 1].content.push(token.slice(9, -3));
      continue;
    }
    if (token.startsWith('</')) {
      const closingName = token.match(/^<\/\s*([^\s>]+)/)?.[1];
      if (!closingName) continue;
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].name === closingName) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    if (!token.startsWith('<')) {
      stack[stack.length - 1].content.push(decodeXml(token));
      continue;
    }

    const body = token.slice(1, -1).trim();
    const selfClosing = /\/$/.test(body);
    const openingBody = selfClosing ? body.replace(/\/$/, '').trim() : body;
    const name = openingBody.match(/^([^\s/>]+)/)?.[1];
    if (!name) continue;

    const attributes: Record<string, string> = {};
    const attributeText = openingBody.slice(name.length);
    const attributePattern = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    for (const match of attributeText.matchAll(attributePattern)) {
      attributes[match[1]] = decodeXml(match[3] ?? match[4] ?? '');
    }

    const element: XmlElement = { name, attributes, content: [] };
    stack[stack.length - 1].content.push(element);
    if (!selfClosing) stack.push(element);
  }

  return document;
}

function textContent(element: XmlElement): string {
  return element.content
    .map((part) => (typeof part === 'string' ? part : textContent(part)))
    .join('');
}

function descendants(
  element: XmlElement,
  predicate: (candidate: XmlElement) => boolean,
): XmlElement[] {
  const result: XmlElement[] = [];
  for (const part of element.content) {
    if (typeof part === 'string') continue;
    if (predicate(part)) result.push(part);
    result.push(...descendants(part, predicate));
  }
  return result;
}

function firstDescendant(
  element: XmlElement,
  predicate: (candidate: XmlElement) => boolean,
): XmlElement | undefined {
  for (const part of element.content) {
    if (typeof part === 'string') continue;
    if (predicate(part)) return part;
    const nested = firstDescendant(part, predicate);
    if (nested) return nested;
  }
  return undefined;
}

function hasClass(element: XmlElement, className: string): boolean {
  return (element.attributes.class ?? '').split(/\s+/).includes(className);
}

function parseTranslation(value: string): { x: number; y: number } | null {
  const match = value.match(
    /translate\(\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*|\s+)(-?\d+(?:\.\d+)?)/i,
  );
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

function parseNumber(value: string | undefined, fallback: number): number {
  const number = Number.parseFloat(value ?? '');
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function cleanParticipantName(value: string): string {
  const name = value.replace(/^\s*\(\d+\)\s*/, '').replace(/\s+/g, ' ').trim();
  const character = name.match(/^(.*?)\s+\(([^()]+)\)$/);
  if (!character || !character[1].trim() || !character[2].trim() || /^\d+$/.test(character[2].trim())) {
    return name;
  }
  return `${character[1].trim()} [${character[2].trim()}]`;
}

function participantRaw(player: XmlElement): string {
  const title = firstDescendant(player, (element) => element.name === 'title');
  return textContent(title ?? player).trim()
    || player.attributes['aria-label']
    || player.attributes['data-name']
    || textContent(player).trim();
}

function participantSeed(player: XmlElement): string | null {
  return participantRaw(player).match(/^\s*\((\d+)\)\s*/)?.[1] ?? null;
}

function participantScore(player: XmlElement): string | null {
  const score = firstDescendant(
    player,
    (element) => ['match--player-score', 'match--score', 'score'].some((name) => hasClass(element, name)),
  );
  return score ? textContent(score).trim() || null : null;
}

function roundNameFromLabel(label: string): string {
  return label
    .replace(/\s*-?\s*Until.*$/i, '')
    .replace(/\s*Best of\s*\d+\s*$/i, '')
    .replace(/\s+-\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRoundName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function parseChallongeBracketSvg(svg: string): TournamentBracketData {
  const document = parseXml(svg);
  const root = descendants(document, (element) => element.name === 'svg' && element.attributes.id === 'top_level')[0];
  if (!root) throw new Error('Challonge did not return a bracket SVG.');

  const viewBox = (root.attributes.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  const width = parseNumber(root.attributes.width, viewBox[2] || 1524);
  const height = parseNumber(root.attributes.height, viewBox[3] || 1486);
  const sections: BracketSection[] = [];
  const roundBySectionAndX = new Map<string, BracketRound>();
  const bracketRounds: Record<BracketSide, BracketRound[]> = {
    winners: [],
    losers: [],
    main: [],
  };

  const roundSections = descendants(root, (element) => element.name === 'g' && hasClass(element, 'rounds'));
  roundSections.forEach((sectionNode, index) => {
    const offset = parseTranslation(sectionNode.attributes.transform ?? '');
    if (!offset) return;
    const roundNodes = descendants(sectionNode, (element) => element.name === 'svg' && hasClass(element, 'round'));
    const parsedRounds = roundNodes.flatMap((round) => {
      const labelParts = descendants(round, (element) =>
        element.name === 'text' && !hasClass(element, 'round-label--best-of'),
      ).map((element) => textContent(element).trim()).filter(Boolean);
      const label = labelParts.join(' ').replace(/\s+/g, ' ').trim();
      const x = Number(round.attributes.x);
      if (!label || !Number.isFinite(x)) return [];
      const bestOf = firstDescendant(round, (element) => hasClass(element, 'round-label--best-of'));
      return [{
        x,
        label,
        name: roundNameFromLabel(label),
        bestOf: bestOf ? textContent(bestOf).trim() || null : null,
      }];
    });
    if (!parsedRounds.length) return;

    const side: BracketSide = parsedRounds.some((round) => /^losers\b/i.test(round.name))
      ? 'losers'
      : parsedRounds.some((round) => /^winners\b/i.test(round.name))
        ? 'winners'
        : 'main';
    sections.push({ index, offsetY: offset.y, side });

    for (const parsed of parsedRounds) {
      const bracketRound: BracketRound = {
        key: `${index}-${side}-${normalizeRoundName(parsed.name) || parsed.x}`,
        name: parsed.name,
        bestOf: parsed.bestOf,
        x: parsed.x,
        sectionY: offset.y,
        matches: [],
      };
      roundBySectionAndX.set(`${index}:${parsed.x}`, bracketRound);
      bracketRounds[side].push(bracketRound);
    }
  });

  if (!sections.length) {
    throw new Error('Challonge SVG did not contain labelled bracket rounds.');
  }

  const orderedSections = [...sections].sort((left, right) => left.offsetY - right.offsetY);
  const matches = descendants(root, (element) =>
    element.name === 'g' && hasClass(element, 'match') && Boolean(element.attributes['data-match-id']),
  );
  for (const match of matches) {
    const position = parseTranslation(match.attributes.transform ?? '');
    if (!position) continue;

    const section = [...orderedSections].filter((candidate) => candidate.offsetY <= position.y).at(-1)
      ?? orderedSections[0];
    let round = roundBySectionAndX.get(`${section.index}:${position.x}`);
    if (!round) {
      const roundsAtX = [...roundBySectionAndX.entries()].filter(([key]) =>
        Number(key.slice(key.lastIndexOf(':') + 1)) === position.x,
      );
      if (roundsAtX.length === 1) round = roundsAtX[0][1];
    }
    if (!round) continue;

    const players = descendants(match, (element) =>
      element.name === 'svg' && hasClass(element, 'match--player') && Boolean(element.attributes['data-participant-id']),
    ).slice(0, 2);
    const names = players.map(participantRaw);
    const seeds = players.map(participantSeed);
    const scores = players.map(participantScore);
    const winnerIndex = players.findIndex((player) =>
      (player.attributes.class ?? '').split(/\s+/).includes('-winner')
      || Boolean(firstDescendant(player, (element) =>
        (element.attributes.class ?? '').split(/\s+/).includes('-winner'),
      )),
    );
    const matchClasses = (match.attributes.class ?? '').split(/\s+/);
    const status: BracketMatchStatus = matchClasses.includes('-complete')
      ? 'complete'
      : matchClasses.includes('-open')
        ? 'open'
        : 'pending';

    while (names.length < 2) names.push('');
    while (seeds.length < 2) seeds.push(null);
    while (scores.length < 2) scores.push(null);
    round.matches.push({
      matchId: match.attributes['data-match-id'] ?? '',
      number: match.attributes['data-identifier'] ?? match.attributes['data-match-id'] ?? '',
      team1: cleanParticipantName(names[0]),
      team2: cleanParticipantName(names[1]),
      team1Seed: seeds[0],
      team2Seed: seeds[1],
      status,
      winner: winnerIndex === 0 ? 1 : winnerIndex === 1 ? 2 : null,
      scores: [scores[0], scores[1]],
      x: position.x,
      y: position.y,
    });
  }

  const connectors = descendants(root, (element) =>
    element.name === 'g' && hasClass(element, 'bracket-line-container'),
  ).flatMap((container) => {
    const position = parseTranslation(container.attributes.transform ?? '');
    if (!position) return [];
    return descendants(container, (element) => element.name === 'path' && hasClass(element, 'bracket-line'))
      .map((path) => path.attributes.d?.trim())
      .filter((path): path is string => Boolean(path))
      .map((path) => ({ x: position.x, y: position.y, path }));
  });

  const matchCount = Object.values(bracketRounds).reduce(
    (total, rounds) => total + rounds.reduce((roundTotal, round) => roundTotal + round.matches.length, 0),
    0,
  );
  if (!matchCount || !connectors.length) {
    throw new Error('Challonge SVG did not contain bracket matches and progression paths.');
  }

  for (const rounds of Object.values(bracketRounds)) {
    rounds.sort((left, right) => left.x - right.x);
    for (const round of rounds) {
      round.matches.sort((left, right) => Number(left.number) - Number(right.number));
    }
  }

  return {
    ...bracketRounds,
    width,
    height,
    sections: orderedSections,
    connectors,
  };
}
