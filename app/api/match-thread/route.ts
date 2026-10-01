import { NextRequest, NextResponse } from 'next/server';
import { findMatchThread } from '@/lib/matchThreads';

export const dynamic = 'force-dynamic';

/**
 * Clicking "Discuss" on any match/fixture card lands here. If that match already has a thread
 * (someone else wrote the first post), jump straight into it. Otherwise send the user to the
 * compose form pre-filled with a title/starter post for that match — nothing is created in the
 * database until they actually submit it, so clicking "Discuss" and not writing anything never
 * leaves a stale, empty thread behind.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const matchKey = searchParams.get('key');
  const p1 = searchParams.get('p1') || 'Player 1';
  const p2 = searchParams.get('p2') || 'Player 2';
  const tournament = searchParams.get('tournament') || '';
  const round = searchParams.get('round') || '';
  const score = searchParams.get('score') || '';
  if (!matchKey) return NextResponse.redirect(new URL('/matches', req.url));

  try {
    const existing = await findMatchThread(matchKey);
    if (existing) return NextResponse.redirect(new URL(`/discussions/${existing}`, req.url));
  } catch {
    return NextResponse.redirect(new URL('/discussions?c=match-talk', req.url));
  }

  const title = `${p1} vs ${p2}${tournament ? ` — ${tournament}` : ''}${round ? ` (${round})` : ''}`.slice(0, 180);
  const body = score
    ? `Discussion thread for **${p1}** vs **${p2}**${tournament ? ` at ${tournament}` : ''}. Final score: ${score}.`
    : `Discussion thread for the upcoming match between **${p1}** and **${p2}**${tournament ? ` at ${tournament}` : ''}.`;

  const compose = new URL('/discussions/new', req.url);
  compose.searchParams.set('matchKey', matchKey);
  compose.searchParams.set('title', title);
  compose.searchParams.set('body', body);
  return NextResponse.redirect(compose);
}
