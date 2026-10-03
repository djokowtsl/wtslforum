export type ModerationStatus = 'approved' | 'pending' | 'rejected';
export type ModerationOutcome = { status: ModerationStatus; reason: string | null };

type ModerationInput = {
  text?: string;
  imageDataUrl?: string;
  imageUrl?: string;
  imageUrls?: string[];
};

type ModerationResponse = {
  results?: Array<{ category_scores?: Record<string, number> }>;
};

export class ModerationUnavailableError extends Error {
  constructor() {
    super('Content screening is temporarily unavailable.');
    this.name = 'ModerationUnavailableError';
  }
}

const REVIEW_AT = 0.2;
const BLOCK_AT = {
  sexual: 0.95,
  'sexual/minors': 0.75,
  'violence/graphic': 0.95,
} as const;

const MAX_LINKED_IMAGES = 4;

/**
 * Applies the forum's narrow NSFW policy. Broad violence, profanity, routine
 * injury discussion, and non-explicit clothing are not block categories.
 */
export async function moderateContent({ text, imageDataUrl, imageUrl, imageUrls }: ModerationInput): Promise<ModerationOutcome> {
  const input: Array<Record<string, unknown>> = [];
  if (text?.trim()) input.push({ type: 'text', text: text.slice(0, 32_000) });
  if (imageDataUrl) input.push({ type: 'image_url', image_url: { url: imageDataUrl } });
  else {
    const images = [...new Set([...(imageUrls || []), ...(imageUrl ? [imageUrl] : [])])].slice(0, MAX_LINKED_IMAGES);
    for (const image of images) input.push({ type: 'image_url', image_url: { url: image } });
  }
  if (!input.length) return { status: 'approved', reason: null };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ModerationUnavailableError();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'omni-moderation-latest', input }),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new ModerationUnavailableError();
    const payload = await response.json() as ModerationResponse;
    if (!Array.isArray(payload.results) || payload.results.length === 0) throw new ModerationUnavailableError();

    const scores: Record<string, number> = {};
    for (const result of payload.results) {
      for (const category of ['sexual', 'sexual/minors', 'violence/graphic']) {
        scores[category] = Math.max(scores[category] || 0, Number(result.category_scores?.[category] || 0));
      }
    }

    const blocked = Object.entries(BLOCK_AT).filter(([category, threshold]) => (scores[category] || 0) >= threshold);
    if (blocked.length) return { status: 'rejected', reason: blocked.map(([category]) => category).join(', ') };

    const uncertain = Object.entries(scores).filter(([, score]) => score >= REVIEW_AT);
    if (uncertain.length) return { status: 'pending', reason: uncertain.map(([category]) => category).join(', ') };
    return { status: 'approved', reason: null };
  } catch (error) {
    if (error instanceof ModerationUnavailableError) throw error;
    throw new ModerationUnavailableError();
  } finally {
    clearTimeout(timer);
  }
}

export function extractImageUrls(text: string) {
  const urls = [...text.matchAll(/https?:\/\/[^\s<>\])}]+/gi)]
    .map((match) => match[0].replace(/[.,!?;:]+$/, ''))
    .filter(looksLikeImageUrl);
  return [...new Set(urls)];
}

export async function moderateTextAndImages(text: string): Promise<ModerationOutcome> {
  const imageUrls = extractImageUrls(text);
  const outcome = await moderateContent({ text, imageUrls: imageUrls.slice(0, MAX_LINKED_IMAGES) });
  if (imageUrls.length > MAX_LINKED_IMAGES && outcome.status === 'approved') {
    return { status: 'pending', reason: 'More than four linked images require moderator review.' };
  }
  return outcome;
}

export function isImageMimeType(contentType: string) {
  return ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType.toLowerCase());
}

export function looksLikeImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /\.(?:jpe?g|png|webp|gif)(?:$|[?#])/i.test(url.href);
  } catch {
    return false;
  }
}