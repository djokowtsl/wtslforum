import { issueSignedToken } from '@vercel/blob';
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { MAX_DMO_BYTES } from '@/lib/te4DmoParser';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED_CONTENT_TYPES = ['application/octet-stream'];
const UPLOAD_PREFIX = 'dmo-analysis/';

function isAllowedPath(pathname: string): boolean {
  if (!pathname.startsWith(UPLOAD_PREFIX) || pathname.length > 180) return false;
  if (!pathname.toLowerCase().endsWith('.dmo') || pathname.includes('\\')) return false;
  return !pathname.split('/').some((segment) => segment === '.' || segment === '..');
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });
  }

  const storeId = process.env.MODERATION_BLOB_STORE_ID;
  if (!storeId) {
    return NextResponse.json({ error: 'Private DMO storage is not configured.' }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid upload request.' }, { status: 400 });
  }

  try {
    const response = await handleUploadPresigned({
      body: body as HandleUploadPresignedBody,
      request,
      getSignedToken: async (pathname) => {
        if (!isAllowedPath(pathname)) {
          throw new Error('Only DMO recordings may be uploaded to this endpoint.');
        }
        const validUntil = Date.now() + 15 * 60 * 1000;
        const token = await issueSignedToken({
          pathname,
          operations: ['put'],
          storeId,
          maximumSizeInBytes: MAX_DMO_BYTES,
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          validUntil,
        });
        return {
          token,
          urlOptions: {
            allowedContentTypes: ALLOWED_CONTENT_TYPES,
            maximumSizeInBytes: MAX_DMO_BYTES,
            validUntil,
          },
        };
      },
    });

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    console.error('[dmo-analysis] private upload token failed');
    const status = /Only DMO recordings/i.test(message) ? 400 : 503;
    return NextResponse.json(
      { error: status === 400 ? message : 'A secure private upload could not be prepared.' },
      { status, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
