import { NextResponse, type NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { claimMatchThread, findMatchThread } from '@/lib/matchThreads';
import { moderateTextAndImages, ModerationUnavailableError } from '@/lib/moderation';
import { normalizePlayerName } from '@/lib/queries';
import { spoilerMarkupError } from '@/lib/spoilers';
import { isTourCode } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type ResultContext = {
  messageId: string;
  createdAt: string;
  date: string;
  tournament: string;
  round: string;
  score: string;
  tour: string | null;
  winners: string[];
  losers: string[];
  content: string;
};

type MatchRow = {
  id: string;
  source_id: string | null;
  source_message_id: string | null;
  tour: string;
  tournament_name: string | null;
  round_name: string | null;
  player_one_id: string;
  player_two_id: string;
  player_one_name: string | null;
  player_two_name: string | null;
  score: string | null;
  winner_id: string | null;
};

class MatchResolutionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const sourceKeyFor = (threadId: string) => `wtsl-interview:${threadId}`;
const slugify = (value: string) =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);

function normalizeName(value: string) {
  return normalizePlayerName(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '');
}

function splitSide(value: string) {
  return value
    .split(/\s*(?:&|\/|\+|,|\band\b)\s*/i)
    .map(normalizeName)
    .filter(Boolean)
    .sort();
}

function sameSide(rowName: string | null, rowId: string, expectedNames: string[]) {
  const raw = rowName || rowId.replace(/^external:/, '');
  const actualParts = splitSide(raw);
  const expectedParts = expectedNames.flatMap(splitSide).sort();
  return actualParts.length === expectedParts.length
    && actualParts.every((part, index) => part === expectedParts[index]);
}

function scorePairs(score: string | null): number[][] {
  if (!score) return [];
  return [...score.matchAll(/(\d{1,2})\s*[-/:]\s*(\d{1,2})(?:\(\d+\))?/g)]
    .map((match) => [Number(match[1]), Number(match[2])]);
}

function scoreMatches(row: MatchRow, expected: string) {
  const actual = scorePairs(row.score);
  const wanted = scorePairs(expected);
  if (!actual.length || actual.length !== wanted.length) return false;
  const winnerIsOne = String(row.winner_id) === String(row.player_one_id);
  if (!winnerIsOne && String(row.winner_id) !== String(row.player_two_id)) return false;
  const oriented = actual.map(([one, two]) => winnerIsOne ? [one, two] : [two, one]);
  return oriented.every(([a, b], index) => a === wanted[index][0] && b === wanted[index][1]);
}

function rowMatchesResult(row: MatchRow, result: ResultContext) {
  const oneWins = String(row.winner_id) === String(row.player_one_id);
  const twoWins = String(row.winner_id) === String(row.player_two_id);
  if (!oneWins && !twoWins) return false;
  const winnerName = oneWins ? row.player_one_name : row.player_two_name;
  const winnerId = oneWins ? row.player_one_id : row.player_two_id;
  const loserName = oneWins ? row.player_two_name : row.player_one_name;
  const loserId = oneWins ? row.player_two_id : row.player_one_id;
  return sameSide(winnerName, winnerId, result.winners)
    && sameSide(loserName, loserId, result.losers)
    && scoreMatches(row, result.score);
}

async function resolveMatch(result: ResultContext) {
  const rows = await sql`
    SELECT m.id::text AS id, m.source_id, m.source_message_id, m.tour,
      m.tournament_name, m.round_name, m.player_one_id, m.player_two_id,
      p1.name AS player_one_name, p2.name AS player_two_name,
      m.score, m.winner_id
    FROM match_stats m
    LEFT JOIN wtsl_players p1
      ON p1.wtsl_player_id=m.player_one_id AND p1.tour=m.tour
    LEFT JOIN wtsl_players p2
      ON p2.wtsl_player_id=m.player_two_id AND p2.tour=m.tour
    WHERE (m.played_at AT TIME ZONE 'UTC')::date=${result.date}::date
      AND lower(trim(COALESCE(m.tournament_name,'')))=lower(trim(${result.tournament}))
      AND lower(trim(COALESCE(m.round_name,'')))=lower(trim(${result.round}))
      AND (${result.tour}::text IS NULL OR m.tour=${result.tour})
    LIMIT 500
  ` as MatchRow[];
  const exact = rows.filter((row) => rowMatchesResult(row, result));
  const direct = exact.filter((row) => row.source_message_id === result.messageId);
  const official = exact.filter((row) => String(row.source_id || '').startsWith('recent:'));
  const preferred = direct.length ? direct : official.length ? official : exact;
  if (preferred.length === 1) return preferred[0];
  if (!preferred.length) {
    throw new MatchResolutionError('No official WTSL match exactly matches the result evidence', 404);
  }
  throw new MatchResolutionError('More than one WTSL match exactly matches the result evidence', 409);
}

function parseResult(body: any): ResultContext | null {
  const raw = body?.result;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const messageId = String(raw.messageId ?? '');
  const createdAt = String(raw.createdAt ?? '');
  const date = String(raw.date ?? '');
  const tournament = String(raw.tournament ?? '').trim();
  const round = String(raw.round ?? '').trim();
  const score = String(raw.score ?? '').trim();
  const content = String(raw.content ?? '');
  const winners = Array.isArray(raw.winners) ? raw.winners.map((name: unknown) => String(name).trim()) : [];
  const losers = Array.isArray(raw.losers) ? raw.losers.map((name: unknown) => String(name).trim()) : [];
  const tour = raw.tour == null ? null : String(raw.tour);
  const timestamp = Date.parse(createdAt);
  const dateValid = Number.isFinite(timestamp)
    && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    && new Date(timestamp).toISOString().slice(0, 10) === date;
  const scoreValid = scorePairs(score);
  if (
    !/^\d{15,22}$/.test(messageId)
    || !Number.isFinite(timestamp)
    || !dateValid
    || !tournament
    || tournament.length > 160
    || !round
    || round.length > 80
    || !scoreValid.length
    || scoreValid.length > 5
    || !/\b(?:defeated|def\.?|beat)\b/i.test(content)
    || content.length > 2000
    || winners.length < 1
    || winners.length > 2
    || losers.length !== winners.length
    || [...winners, ...losers].some((name) => !name || name.length > 100)
    || (tour !== null && !isTourCode(tour))
  ) return null;
  return { messageId, createdAt, date, tournament, round, score, tour, winners, losers, content };
}

function published(req: NextRequest, topicId: number, matchKey: string, postType: string) {
  const url = new URL(`/discussions/${topicId}`, req.url).toString();
  return NextResponse.json({ status: 'published', url, matchKey, postType });
}

function pending(message: string) {
  return NextResponse.json({ status: 'pending', message }, { status: 202 });
}

async function findSourcePosts(sourceKey: string) {
  const topics = await sql`
    SELECT id, body, moderation_status FROM topics WHERE source_key=${sourceKey} LIMIT 1
  `;
  const replies = await sql`
    SELECT r.id, r.topic_id, r.moderation_status,
      t.moderation_status AS topic_moderation_status
    FROM replies r
    LEFT JOIN topics t ON t.id=r.topic_id
    WHERE r.source_key=${sourceKey}
    LIMIT 1
  `;
  return { topic: topics[0] ?? null, reply: replies[0] ?? null };
}

async function removeOrphanSourceTopic(topicId: number, sourceKey: string) {
  const removed = await sql`
    DELETE FROM topics source
    WHERE source.id=${topicId}
      AND source.source_key=${sourceKey}
      AND NOT EXISTS (SELECT 1 FROM replies r WHERE r.topic_id=source.id)
      AND NOT EXISTS (SELECT 1 FROM match_threads mt WHERE mt.topic_id=source.id)
    RETURNING source.id
  `;
  return Boolean(removed[0]);
}

async function insertInterviewReply(
  topicId: number,
  sourceKey: string,
  body: string,
  moderationStatus: string,
  moderationReason: string | null,
) {
  const inserted = await sql`
    INSERT INTO replies(topic_id,author_id,body,moderation_status,moderation_reason,source_key)
    VALUES (${topicId},NULL,${body},${moderationStatus},${moderationReason},${sourceKey})
    ON CONFLICT (source_key) DO NOTHING
    RETURNING id
  `;
  const existing = inserted[0]
    ? await sql`SELECT id, topic_id, moderation_status FROM replies WHERE id=${Number(inserted[0].id)} LIMIT 1`
    : await sql`SELECT id, topic_id, moderation_status FROM replies WHERE source_key=${sourceKey} LIMIT 1`;
  return existing[0]
    ? {
        id: Number(existing[0].id),
        topicId: Number(existing[0].topic_id),
        moderationStatus: String(existing[0].moderation_status),
        created: Boolean(inserted[0]),
      }
    : null;
}

async function convertSourceTopicToReply(
  topicId: number,
  destinationTopicId: number,
  sourceKey: string,
  body: string,
  req: NextRequest,
  matchKey: string,
) {
  const reply = await insertInterviewReply(destinationTopicId, sourceKey, body, 'approved', null);
  if (!reply) {
    return NextResponse.json({ error: 'Could not safely attach the transcript to the existing match discussion.' }, { status: 409 });
  }
  if (reply.topicId !== destinationTopicId) {
    return NextResponse.json({ error: 'The transcript is already linked to a different discussion.' }, { status: 409 });
  }
  if (reply.moderationStatus === 'pending') {
    return pending('The interview is waiting for moderator review.');
  }
  if (reply.moderationStatus === 'rejected') {
    return NextResponse.json({ error: 'The interview transcript was rejected by moderation.' }, { status: 422 });
  }
  const removed = await removeOrphanSourceTopic(topicId, sourceKey);
  if (!removed) {
    const sourceTopic = await sql`SELECT id FROM topics WHERE id=${topicId} AND source_key=${sourceKey} LIMIT 1`;
    if (!sourceTopic[0]) return published(req, destinationTopicId, matchKey, 'reply');
    if (reply.created) {
      await sql`DELETE FROM replies WHERE id=${reply.id} AND source_key=${sourceKey} AND topic_id=${destinationTopicId}`;
    }
    return NextResponse.json({ error: 'The interview topic changed while it was being linked; no transcript link was sent.' }, { status: 409 });
  }
  return published(req, destinationTopicId, matchKey, 'reply');
}

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.WTSL_SYNC_SECRET;
  if (!expectedSecret || req.headers.get('x-wtsl-sync-secret') !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (contentLength > 30_000) return NextResponse.json({ error: 'Transcript request is too large.' }, { status: 413 });

  const body = await req.json().catch(() => null);
  const threadId = String(body?.discordThreadId ?? '');
  const threadName = typeof body?.threadName === 'string' ? body.threadName.trim().slice(0, 100) : '';
  const transcript = typeof body?.transcript === 'string' ? body.transcript.trim() : '';
  const result = parseResult(body);
  if (!/^\d{15,22}$/.test(threadId) || !threadName || !transcript || transcript.length > 18_000 || !result) {
    return NextResponse.json({ error: 'Invalid or incomplete interview transcript payload.' }, { status: 400 });
  }
  const spoilerError = spoilerMarkupError(transcript);
  if (spoilerError) return NextResponse.json({ error: spoilerError }, { status: 400 });

  let match: MatchRow;
  try {
    match = await resolveMatch(result);
  } catch (error) {
    if (error instanceof MatchResolutionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[interview-transcripts] match resolution failed', error);
    return NextResponse.json({ error: 'Match resolution failed.' }, { status: 500 });
  }
  const matchKey = `match-${match.id}`;
  const sourceKey = sourceKeyFor(threadId);
  const resultSummary = `**${result.winners.join(' & ')} def. ${result.losers.join(' & ')} — ${result.tournament}, ${result.round} (${result.date}; ${result.score})**`;
  const postBody = `${resultSummary}\n\n${transcript}`;
  if (postBody.length > 20_000) {
    return NextResponse.json({ error: 'The transcript is too long for a forum post.' }, { status: 400 });
  }

  const existing = await findSourcePosts(sourceKey);
  if (existing.reply) {
    if (existing.reply.moderation_status === 'pending' || existing.reply.topic_moderation_status === 'pending') {
      return pending('The interview is waiting for moderator review.');
    }
    if (existing.reply.moderation_status === 'rejected' || existing.reply.topic_moderation_status === 'rejected') {
      return NextResponse.json({ error: 'The interview transcript was rejected by moderation.' }, { status: 422 });
    }
    if (existing.reply.topic_moderation_status !== 'approved') {
      return NextResponse.json({ error: 'The match discussion is no longer available.' }, { status: 409 });
    }
    if (existing.topic && Number(existing.topic.id) !== Number(existing.reply.topic_id)) {
      const removed = await removeOrphanSourceTopic(Number(existing.topic.id), sourceKey);
      if (!removed) {
        return NextResponse.json({ error: 'The transcript is linked, but its original topic has active discussion.' }, { status: 409 });
      }
    }
    return published(req, Number(existing.reply.topic_id), matchKey, 'reply');
  }

  if (existing.topic) {
    if (existing.topic.moderation_status === 'pending') {
      return pending('The interview is waiting for moderator review.');
    }
    if (existing.topic.moderation_status === 'rejected') {
      return NextResponse.json({ error: 'The interview transcript was rejected by moderation.' }, { status: 422 });
    }
    const linkedTopicId = await claimMatchThread(matchKey, Number(existing.topic.id), match.tour);
    if (linkedTopicId === Number(existing.topic.id)) {
      return published(req, linkedTopicId, matchKey, 'topic');
    }
    const destination = await sql`
      SELECT id, locked, moderation_status FROM topics WHERE id=${linkedTopicId} LIMIT 1
    `;
    if (!destination[0] || destination[0].moderation_status !== 'approved' || destination[0].locked) {
      return NextResponse.json({ error: 'The existing match discussion is unavailable or locked.' }, { status: 409 });
    }
    return convertSourceTopicToReply(
      Number(existing.topic.id),
      linkedTopicId,
      sourceKey,
      String(existing.topic.body),
      req,
      matchKey,
    );
  }

  let decision: Awaited<ReturnType<typeof moderateTextAndImages>>;
  try {
    decision = await moderateTextAndImages(postBody);
  } catch (error) {
    if (error instanceof ModerationUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
  if (decision.status === 'rejected') {
    return NextResponse.json({ error: 'The interview transcript was rejected by moderation.' }, { status: 422 });
  }

  let linkedTopicId = await findMatchThread(matchKey, match.tour);
  if (linkedTopicId) {
    const destination = await sql`
      SELECT id, locked, moderation_status FROM topics WHERE id=${linkedTopicId} LIMIT 1
    `;
    if (!destination[0]) {
      return NextResponse.json({ error: 'The linked match discussion is missing.' }, { status: 409 });
    }
    if (destination[0].moderation_status === 'pending') {
      return pending('The existing match discussion is waiting for moderator review.');
    }
    if (destination[0].moderation_status !== 'approved' || destination[0].locked) {
      return NextResponse.json({ error: 'The existing match discussion is unavailable or locked.' }, { status: 409 });
    }
    const reply = await insertInterviewReply(
      linkedTopicId,
      sourceKey,
      postBody,
      decision.status,
      decision.reason,
    );
    if (!reply || reply.topicId !== linkedTopicId) {
      return NextResponse.json({ error: 'Transcript idempotency check failed.' }, { status: 409 });
    }
    if (reply.moderationStatus === 'pending') return pending('The interview is waiting for moderator review.');
    if (reply.moderationStatus === 'rejected') {
      return NextResponse.json({ error: 'The interview transcript was rejected by moderation.' }, { status: 422 });
    }
    await sql`UPDATE topics SET updated_at=NOW() WHERE id=${linkedTopicId}`;
    return published(req, linkedTopicId, matchKey, 'reply');
  }

  const categories = await sql`SELECT id FROM categories WHERE slug='match-talk' LIMIT 1`;
  if (!categories[0]) return NextResponse.json({ error: 'The Match Talk category is unavailable.' }, { status: 500 });
  const title = `${result.winners.join(' & ')} def. ${result.losers.join(' & ')} — ${result.tournament} (${result.round})`.slice(0, 140);
  const slug = `${slugify(title)}-interview-${threadId}`.slice(0, 150);
  const inserted = await sql`
    INSERT INTO topics(category_id,author_id,title,slug,body,moderation_status,moderation_reason,source_key)
    VALUES (${Number(categories[0].id)},NULL,${title},${slug},${postBody},${decision.status},${decision.reason},${sourceKey})
    ON CONFLICT (source_key) DO NOTHING
    RETURNING id
  `;
  if (!inserted[0]) {
    const raced = await findSourcePosts(sourceKey);
    if (raced.topic?.moderation_status === 'pending') return pending('The interview is waiting for moderator review.');
    if (raced.topic?.moderation_status === 'approved') {
      const racedTopicId = Number(raced.topic.id);
      const winnerId = await claimMatchThread(matchKey, racedTopicId, match.tour);
      if (winnerId === racedTopicId) return published(req, winnerId, matchKey, 'topic');
      const destination = await sql`
        SELECT id, locked, moderation_status FROM topics WHERE id=${winnerId} LIMIT 1
      `;
      if (!destination[0] || destination[0].moderation_status !== 'approved' || destination[0].locked) {
        return NextResponse.json({ error: 'The existing match discussion is unavailable or locked.' }, { status: 409 });
      }
      return convertSourceTopicToReply(
        racedTopicId,
        winnerId,
        sourceKey,
        String(raced.topic.body),
        req,
        matchKey,
      );
    }
    if (raced.topic?.moderation_status === 'rejected') {
      return NextResponse.json({ error: 'The interview transcript was rejected by moderation.' }, { status: 422 });
    }
    return NextResponse.json({ error: 'The transcript was concurrently submitted; retry safely.' }, { status: 409 });
  }

  const topicId = Number(inserted[0].id);
  if (decision.status === 'pending') return pending('The interview is waiting for moderator review.');
  linkedTopicId = await claimMatchThread(matchKey, topicId, match.tour);
  if (linkedTopicId === topicId) return published(req, topicId, matchKey, 'topic');

  const destination = await sql`
    SELECT id, locked, moderation_status FROM topics WHERE id=${linkedTopicId} LIMIT 1
  `;
  if (!destination[0] || destination[0].moderation_status !== 'approved' || destination[0].locked) {
    return NextResponse.json({ error: 'The existing match discussion is unavailable or locked.' }, { status: 409 });
  }
  return convertSourceTopicToReply(
    topicId,
    linkedTopicId,
    sourceKey,
    postBody,
    req,
    matchKey,
  );
}