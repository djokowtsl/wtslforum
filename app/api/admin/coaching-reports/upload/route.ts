import { issueSignedToken } from '@vercel/blob';
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  COACHING_REPLAY_STAGING_PREFIX,
  isCoachingReplayStagingPath,
  MAX_COACHING_REPLAY_BYTES,
} from '@/lib/coachingReportViewer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED_CONTENT_TYPES = ['application/json'];

export async function POST(request: Request) {
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  }

  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!storeId) {
    return NextResponse.json(
      { error: 'Private replay storage is not configured.' },
      { status: 503 },
    );
  }

  try {
    const response = await handleUploadPresigned({
      body: await request.json() as HandleUploadPresignedBody,
      request,
      getSignedToken: async (pathname) => {
        if (
          !isCoachingReplayStagingPath(pathname)
          || !pathname.startsWith(COACHING_REPLAY_STAGING_PREFIX)
        ) {
          throw new Error('Only coaching replay data can be uploaded here.');
        }
        const validUntil = Date.now() + 15 * 60 * 1000;
        const token = await issueSignedToken({
          pathname,
          operations: ['put'],
          storeId,
          maximumSizeInBytes: MAX_COACHING_REPLAY_BYTES,
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          validUntil,
        });
        return {
          token,
          urlOptions: {
            allowedContentTypes: ALLOWED_CONTENT_TYPES,
            maximumSizeInBytes: MAX_COACHING_REPLAY_BYTES,
            validUntil,
          },
        };
      },
    });
    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    console.error('[coaching-reports] private replay upload preparation failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'A secure private replay upload could not be prepared.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
