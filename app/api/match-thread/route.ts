import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateMatchThread } from '@/lib/matchThreads';

export const dynamic = 'force-dynamic';

/** Clicking "Discuss" on any match/fixture card lands here, which finds (or creates on first
 * click) the Match Talk thread for that exact match and redirects straight into it — so nobody
 * has to go find or start the thread themselves. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const matchKey = searchParams.get('key');
  const p1 = searchParams.get('p1') || 'Player 1';
  const p2 = searchParams.get('p2') || 'Player 2';
  const tournament = searchParams.get('tournament') || '';
  const round = searchParams.get('round') || '';
  const score = searchParams.get('score') || '';
  if (!matchKey) return NextResponse.redirect(new URL('/matches', req.url));

  const title = `${p1} vs ${p2}${tournament ? ` — ${tournament}` : ''}${round ? ` (${round})` : ''}`.slice(0, 180);
  const body = score
    ? `Discussion thread for **${p1}** vs **${p2}**${tournament ? ` at ${tournament}` : ''}. Final score: ${score}.`
    : `Discussion thread for the upcoming match between **${p1}** and **${p2}**${tournament ? ` at ${tournament}` : ''}.`;

  try {
    const topicId = await getOrCreateMatchThread(matchKey, title, body);
    return NextResponse.redirect(new URL(`/discussions/${topicId}`, req.url));
  } catch {
    return NextResponse.redirect(new URL('/discussions?c=match-talk', req.url));
  }
}
