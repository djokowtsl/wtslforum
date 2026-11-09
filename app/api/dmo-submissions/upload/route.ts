import { del, issueSignedToken } from '@vercel/blob';
import { handleUploadPresigned, type HandleUploadPresignedBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  isOwnedDmoSubmissionUploadPath,
  MAX_DMO_SUBMISSION_BYTES,
} from '@/lib/dmoSubmissionUpload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_CONTENT_TYPES = ['application/octet-stream'];

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Log in with Discord to upload a match recording.' }, { status: 401 });

  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!storeId) {
    return NextResponse.json({ error: 'Private DMO storage is not configured yet.' }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Could not authorize the recording upload.' }, { status: 400 });

  try {
    const response = await handleUploadPresigned({
      body: body as HandleUploadPresignedBody,
      request,
      getSignedToken: async (pathname, _clientPayload, multipart) => {
        if (multipart || !isOwnedDmoSubmissionUploadPath(pathname, user.id)) {
          throw new Error('Invalid private recording upload path.');
        }
        const token = await issueSignedToken({
          pathname,
          operations: ['put'],
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_DMO_SUBMISSION_BYTES,
          validUntil: Date.now() + 15 * 60 * 1000,
          storeId,
        });
        return { token };
      },
    });
    return NextResponse.json(response);
  } catch (error) {
    console.error('[dmo] direct upload authorization failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Could not authorize the private recording upload.' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Log in with Discord to manage a recording upload.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const pathname = body?.pathname;
  if (!isOwnedDmoSubmissionUploadPath(pathname, user.id)) {
    return NextResponse.json({ error: 'This upload does not belong to your account.' }, { status: 403 });
  }

  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!storeId) {
    return NextResponse.json({ error: 'Private DMO storage is not configured yet.' }, { status: 503 });
  }

  try {
    await del(pathname, { storeId });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'The temporary recording could not be removed.' }, { status: 503 });
  }
}
