import { NextRequest, NextResponse } from 'next/server';
    import {
    MatchResolutionError,
    parseInterviewResult,
    resolveInterviewMatch,
    } from '@/lib/interviewMatchResolution';

    export const dynamic = 'force-dynamic';
    export const maxDuration = 60;

    /** Read-only match resolution used before the bot publishes an ambiguous interview result. */
    export async function POST(req: NextRequest) {
    const expectedSecret = process.env.WTSL_SYNC_SECRET;
    if (!expectedSecret || req.headers.get('x-wtsl-sync-secret') !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (contentLength > 60_000) {
      return NextResponse.json({ error: 'Candidate request is too large.' }, { status: 413 });
    }

    const body = await req.json().catch(() => null);
    const candidates = body?.candidates;
    if (!Array.isArray(candidates) || candidates.length < 2) {
      return NextResponse.json({ error: 'At least two result candidates are required.' }, { status: 400 });
    }
    if (candidates.length > 20) {
      return NextResponse.json({ error: 'At most 20 result candidates can be resolved at once.' }, { status: 413 });
    }
    const results = candidates.map((candidate: unknown) => parseInterviewResult({ result: candidate }));
    if (results.some((result: unknown) => result === null)) {
      return NextResponse.json({ error: 'Every candidate must contain complete result evidence.' }, { status: 400 });
    }

    const matches: Array<{ candidateIndex: number; matchId: string }> = [];
    for (let candidateIndex = 0; candidateIndex < results.length; candidateIndex += 1) {
      try {
        const match = await resolveInterviewMatch(results[candidateIndex]!);
        matches.push({ candidateIndex, matchId: match.id });
      } catch (error) {
        if (error instanceof MatchResolutionError && error.status === 404) continue;
        if (error instanceof MatchResolutionError && error.status === 409) {
          return NextResponse.json(
            { status: 'ambiguous', error: error.message },
            { status: 409 },
          );
        }
        console.error('[interview-match-resolution] failed', error);
        return NextResponse.json({ error: 'Candidate match resolution failed.' }, { status: 500 });
      }
    }

    if (matches.length === 0) {
      return NextResponse.json({ status: 'unmatched' });
    }
    if (matches.length !== 1) {
      return NextResponse.json(
        { status: 'ambiguous', error: 'More than one candidate matches a completed Forum result.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ status: 'matched', ...matches[0] });
    }
    