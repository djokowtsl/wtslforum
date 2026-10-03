import { NextRequest, NextResponse } from 'next/server';
import { del, put } from '@vercel/blob';
import { getSession } from '@/lib/auth';
import { addClip } from '@/lib/media';
import { isTourCode } from '@/lib/wtsl';
import { isImageMimeType, looksLikeImageUrl, moderateContent, ModerationUnavailableError } from '@/lib/moderation';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Log in with Discord to submit a clip.' }, { status: 401 });

  const isMultipart = req.headers.get('content-type')?.includes('multipart/form-data') ?? false;
  const form = isMultipart ? await req.formData().catch(() => null) : null;
  const body = isMultipart ? null : await req.json().catch(() => null);
  const title = String(form?.get('title') ?? body?.title ?? '').trim().slice(0, 120);
  const description = String(form?.get('description') ?? body?.description ?? '').trim().slice(0, 500);
  const url = String(form?.get('url') ?? body?.url ?? '').trim().slice(0, 2048);
  const rawTour = form?.get('tour') ?? body?.tour;
  const tour = isTourCode(rawTour) ? rawTour : null;
  const file = form?.get('file');
  const upload = file instanceof File ? file : null;

  if (!title || (!url && !upload)) return NextResponse.json({ error: 'A title and a link or uploaded file are required.' }, { status: 400 });
  if (url && !/^https?:\/\//i.test(url)) return NextResponse.json({ error: 'That link does not look valid.' }, { status: 400 });
  if (upload && upload.size > MAX_BYTES) return NextResponse.json({ error: 'File is too large (20MB max).' }, { status: 413 });
  if (upload && !(isImageMimeType(upload.type) || upload.type.startsWith('video/'))) {
    return NextResponse.json({ error: 'Upload a JPEG, PNG, WebP, GIF, or video file.' }, { status: 415 });
  }

  let decision;
  try {
    decision = await moderateContent({
      text: `${title}\n${description}`,
      ...(upload && isImageMimeType(upload.type)
        ? { imageDataUrl: `data:${upload.type};base64,${Buffer.from(await upload.arrayBuffer()).toString('base64')}` }
        : !upload && url && looksLikeImageUrl(url) ? { imageUrl: url } : {}),
    });
  } catch (error) {
    if (error instanceof ModerationUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    throw error;
  }
  if (decision.status === 'rejected') {
    return NextResponse.json({ error: 'This submission appears to contain prohibited explicit sexual content or graphic gore.' }, { status: 422 });
  }

  // The selected moderation API screens still images, not video frames or arbitrary external media.
  // Keep those submissions private until a moderator has reviewed the actual clip.
  const requiresManualReview = !!upload && upload.type.startsWith('video/') || (!!url && !looksLikeImageUrl(url));
  const status = decision.status === 'pending' || requiresManualReview ? 'pending' : 'approved';
  const reason = decision.reason || (requiresManualReview ? 'Media content requires moderator review.' : null);

  let publicUrl = url;
  let privatePathname: string | null = null;
  let privateContentType: string | null = null;
  try {
    if (upload && status === 'approved') {
      const blob = await put(`media/${Date.now()}-${upload.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100)}`, upload, {
        access: 'public',
        addRandomSuffix: true,
        contentType: upload.type,
      });
      publicUrl = blob.url;
    } else if (upload) {
      const storeId = process.env.MODERATION_BLOB_STORE_ID;
      if (!storeId) return NextResponse.json({ error: 'Private moderation storage is not configured yet.' }, { status: 503 });
      const blob = await put(`pending/${Date.now()}-${upload.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100)}`, upload, {
        access: 'private',
        addRandomSuffix: true,
        contentType: upload.type,
        storeId,
      });
      privatePathname = blob.pathname;
      privateContentType = upload.type;
      publicUrl = '';
    }
  } catch (error) {
    console.error('[moderation] media upload failed', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'The file could not be stored securely. Please try again later.' }, { status: 503 });
  }

  try {
    const clip = await addClip(Number(user.id), title, description, publicUrl, tour, {
      status,
      reason,
      privatePathname,
      privateContentType,
    });
    if (status === 'pending') {
      return NextResponse.json({ ok: true, pending: true, message: 'Your submission is waiting for moderator review.' }, { status: 202 });
    }
    return NextResponse.json({ ok: true, clip }, { status: 201 });
  } catch (error) {
    if (privatePathname) {
      await del(privatePathname, { storeId: process.env.MODERATION_BLOB_STORE_ID }).catch(() => {});
    }
    throw error;
  }
}