import { NextResponse, type NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import {
  MatchResolutionError,
  parseInterviewResult,
  resolveInterviewMatch,
  type MatchRow,
  type ResultContext,
} from '@/lib/interviewMatchResolution';
import { claimMatchThread, findMatchThread } from '@/lib/matchThreads';
import { moderateTextAndImages, ModerationUnavailableError } from '@/lib/moderation';
import { spoilerMarkupError } from '@/lib/spoilers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const sourceKeyFor = (threadId: string) => `wtsl-interview:${threadId}`;
const slugify = (value: string) =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);

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

function normalizeTopicTitle(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Reuse a clearly identified older Match Talk topic that predates match-key linking. */
async function findLegacyMatchDiscussion(match: MatchRow, result: ResultContext) {
  const playerOne = String(match.player_one_name || '').trim();
  const playerTwo = String(match.player_two_name || '').trim();
  if (!playerOne || !playerTwo || !result.tournament || !result.round) return [];

  // Match-card discussions use this title shape. Restrict candidates to the match date
  // window and exclude topics already associated with another match; uncertain matches
  // are handled as conflicts rather than silently creating a duplicate discussion.
  const forwardTitle = normalizeTopicTitle((playerOne + ' vs ' + playerTwo + ' — ' + result.tournament + ' (' + result.round + ')').slice(0, 180));
  const reverseTitle = normalizeTopicTitle((playerTwo + ' vs ' + playerOne + ' — ' + result.tournament + ' (' + result.round + ')').slice(0, 180));
  return await sql`
    SELECT t.id::text AS id, t.locked, t.moderation_status
    FROM topics t
    JOIN categories c ON c.id=t.category_id
    WHERE c.slug='match-talk'
      AND (lower(trim(t.title))=${forwardTitle} OR lower(trim(t.title))=${reverseTitle})
      AND t.created_at >= (${result.createdAt}::timestamptz - interval '45 days')
      AND t.created_at <= (${result.createdAt}::timestamptz + interval '45 days')
      AND NOT EXISTS (SELECT 1 FROM match_threads mt WHERE mt.topic_id=t.id)
    ORDER BY t.created_at DESC
    LIMIT 3
  `;
}

async function findOrClaimMatchDiscussion(
  matchKey: string,
  match: MatchRow,
  result: ResultContext,
): Promise<{ topicId: number | null; ambiguous: boolean }> {
  const linked = await findMatchThread(matchKey, match.tour);
  if (linked) return { topicId: linked, ambiguous: false };
  const legacy = await findLegacyMatchDiscussion(match, result);
  if (legacy.length > 1) return { topicId: null, ambiguous: true };
  if (!legacy.length) return { topicId: null, ambiguous: false };
  return {
    topicId: await claimMatchThread(matchKey, Number(legacy[0].id), match.tour),
    ambiguous: false,
  };
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
  const result = parseInterviewResult(body);
  if (!/^\d{15,22}$/.test(threadId) || !threadName || !transcript || transcript.length > 18_000 || !result) {
    return NextResponse.json({ error: 'Invalid or incomplete interview transcript payload.' }, { status: 400 });
  }
  const spoilerError = spoilerMarkupError(transcript);
  if (spoilerError) return NextResponse.json({ error: spoilerError }, { status: 400 });

  let match: MatchRow;
  try {
    match = await resolveInterviewMatch(result);
  } catch (error) {
    if (error instanceof MatchResolutionError) {
        if (error.status === 404) {
          return pending(
            'No exact official WTSL match is available for this result yet. The transcript remains unpublished and will be retried.',
            'official_match_not_found',
          );
        }
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
    const matchDiscussion = await findOrClaimMatchDiscussion(matchKey, match, result);
    if (matchDiscussion.ambiguous) {
      return NextResponse.json({ error: 'More than one older Match Talk discussion could match this result.' }, { status: 409 });
    }
    const linkedTopicId = matchDiscussion.topicId
      ?? await claimMatchThread(matchKey, Number(existing.topic.id), match.tour);
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

  const matchDiscussion = await findOrClaimMatchDiscussion(matchKey, match, result);
  if (matchDiscussion.ambiguous) {
    return NextResponse.json({ error: 'More than one older Match Talk discussion could match this result.' }, { status: 409 });
  }
  let linkedTopicId = matchDiscussion.topicId;
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