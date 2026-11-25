const CHALLONGE_BASE =
  'https://91d510368cb4170cd5ac3776.challonge.com';
const CHALLONGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

export function getChallongeTournamentId(officialUrl: string): string | null {
  try {
    const url = new URL(officialUrl);
    if (
      url.protocol !== 'https:' ||
      !['playwtsl.com', 'www.playwtsl.com'].includes(url.hostname.toLowerCase())
    ) {
      return null;
    }

    const tournamentId = url.searchParams.get('tournament')?.trim() ?? '';
    return CHALLONGE_ID_PATTERN.test(tournamentId) ? tournamentId : null;
  } catch {
    return null;
  }
}

export function getChallongeTournamentUrl(officialUrl: string): string | null {
  const tournamentId = getChallongeTournamentId(officialUrl);
  return tournamentId
    ? `${CHALLONGE_BASE}/${encodeURIComponent(tournamentId)}`
    : null;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const point = Number.parseInt(hex, 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : '';
    })
    .replace(/&#(\d+);/g, (_match, decimal: string) => {
      const point = Number.parseInt(decimal, 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : '';
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function addCharacterPickBrackets(svg: string): string {
  if (!/<svg\b[^>]*\bid=["']top_level["']/i.test(svg)) {
    throw new Error('Challonge did not return a bracket SVG.');
  }

  return svg.replace(
    /<svg\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bmatch--player\b[^"']*\1)[^>]*>[\s\S]*?<\/svg>/gi,
    (playerSvg) => {
      let updated = playerSvg.replace(
        /<title>([\s\S]*?)<\/title>/i,
        (element, content: string) => {
          const label = formatParticipantLabel(content);
          if (label === content) return element;
          return `<title>${label}</title>`;
        },
      );

      updated = updated.replace(
        /<text\b([^>]*)>([\s\S]*?)<\/text>/gi,
        (element, attributes: string, content: string) => {
          const className = attributes.match(/\bclass\s*=\s*(["'])(.*?)\1/i)?.[2];
          if (
            !className?.split(/\s+/).includes('match--player-name') ||
            /<[^>]+>/.test(content)
          ) {
            return element;
          }

          const label = formatParticipantLabel(content);
          if (label === content) return element;
          return `<text${attributes}>${label}</text>`;
        },
      );

      return updated;
    },
  );
}

function formatParticipantLabel(xmlText: string): string {
  const value = decodeXmlText(xmlText).trim();
  const match = value.match(/^(.*?)\s+\(([^()]+)\)$/);
  if (!match || !match[1].trim() || !match[2].trim() || /^\d+$/.test(match[2].trim())) {
    return xmlText;
  }

  return escapeXmlText(`${match[1].trim()} [${match[2].trim()}]`);
}
