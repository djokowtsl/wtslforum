export type GoogleFormOptionQuestion = {
  title: string;
  slug: string;
  options: string[];
  allowWriteIn: boolean;
};

const MAX_FORM_BYTES = 2_000_000;
const MAX_QUESTIONS = 40;
const MAX_CHOICES_PER_QUESTION = 150;
const FORM_DATA_MARKER = 'var FB_PUBLIC_LOAD_DATA_ =';

export function googleFormCategorySlug(title: string) {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug === 'fans-favorite-award' || slug === 'fans-favourite-award') return 'fans-favourite';
  if (slug === 'best-dressed') return 'best-dressed-player';
  if (slug === 'stefan-edberg-sportsmanship-award') return 'stefan-edberg-sportsmanship';
  if (slug === 'arthur-ashe-humanitarian-award') return 'arthur-ashe-humanitarian';
  return slug;
}

export function validatePublicGoogleFormUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a valid public Google Form link.');
  }

  const validShortLink = url.hostname === 'forms.gle'
    && /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
  const validLongLink = url.hostname === 'docs.google.com'
    && /^\/forms\/d\/e\/[A-Za-z0-9_-]+\/viewform\/?$/.test(url.pathname);

  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || (!validShortLink && !validLongLink)
  ) {
    throw new Error('Use a public forms.gle link or a docs.google.com/forms/d/e/.../viewform link.');
  }

  return url;
}

function arrayAt(value: unknown, index: number): unknown {
  return Array.isArray(value) ? value[index] : undefined;
}

export function parsePublicGoogleFormOptions(html: string): GoogleFormOptionQuestion[] {
  if (Buffer.byteLength(html, 'utf8') > MAX_FORM_BYTES) {
    throw new Error('The Google Form page is too large to import safely.');
  }

  const markerIndex = html.indexOf(FORM_DATA_MARKER);
  if (markerIndex < 0) {
    throw new Error('Could not read choices from this form. Check that it is public and uses single-choice or dropdown questions.');
  }

  const dataStart = markerIndex + FORM_DATA_MARKER.length;
  const dataEnd = html.indexOf(';</script>', dataStart);
  if (dataEnd < 0) {
    throw new Error('Google Form data was incomplete. Try again or use a different public form link.');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(html.slice(dataStart, dataEnd));
  } catch {
    throw new Error('Google Form data could not be parsed. Google may have changed its public form format.');
  }

  const pages = arrayAt(payload, 1);
  const questionRows = arrayAt(pages, 1);
  if (!Array.isArray(questionRows)) {
    throw new Error('No award questions were found in this Google Form.');
  }

  const questions: GoogleFormOptionQuestion[] = [];
  for (const row of questionRows) {
    const title = arrayAt(row, 1);
    const questionType = arrayAt(row, 3);
    const optionGroups = arrayAt(row, 4);
    if (typeof title !== 'string' || !title.trim() || ![2, 4].includes(Number(questionType)) || !Array.isArray(optionGroups)) {
      continue;
    }

    const rawOptions = optionGroups.flatMap((group) => {
      const choices = arrayAt(group, 1);
      return Array.isArray(choices) ? choices.map((choice) => arrayAt(choice, 0)) : [];
    });
    const allowWriteIn = rawOptions.some((option) => typeof option === 'string' && !option.trim());
    const seen = new Set<string>();
    const options = rawOptions
      .filter((option): option is string => typeof option === 'string' && Boolean(option.trim()))
      .map((option) => option.trim().slice(0, 300))
      .filter((option) => {
        const key = option.toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const slug = googleFormCategorySlug(title);
    if (!slug || options.length === 0) continue;
    if (options.length > MAX_CHOICES_PER_QUESTION) {
      throw new Error(`“${title.trim()}” has too many choices to import.`);
    }

    questions.push({
      title: title.trim().slice(0, 120),
      slug,
      options,
      allowWriteIn,
    });
  }

  if (questions.length === 0) {
    throw new Error('No single-choice or dropdown award questions with choices were found.');
  }
  if (questions.length > MAX_QUESTIONS) {
    throw new Error('This form has too many award questions to import safely.');
  }
  return questions;
}

export async function fetchPublicGoogleFormOptions(value: string) {
  const url = validatePublicGoogleFormUrl(value);
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      headers: { accept: 'text/html' },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error('Could not load the Google Form. Check the link and try again.');
  }

  let finalUrl: URL;
  try {
    finalUrl = new URL(response.url);
  } catch {
    throw new Error('Google Form redirected to an invalid address.');
  }

  if (!response.ok || finalUrl.hostname !== 'docs.google.com' || !/^\/forms\/d\/e\/[A-Za-z0-9_-]+\/viewform\/?$/.test(finalUrl.pathname)) {
    throw new Error('The link did not resolve to a public Google Form response page.');
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_FORM_BYTES) {
    throw new Error('The Google Form page is too large to import safely.');
  }

  const html = await response.text();
  return {
    sourceUrl: finalUrl.toString(),
    questions: parsePublicGoogleFormOptions(html),
  };
}
