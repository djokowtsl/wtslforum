import { sql } from './db';
import type { TourCode } from './wtsl';

export async function getClips(tour?: TourCode, limit = 60) {
  return tour
    ? sql`SELECT c.*,u.display_name author,u.avatar_url avatar FROM media_clips c LEFT JOIN users u ON u.id=c.submitted_by WHERE c.moderation_status='approved' AND c.tour=${tour} ORDER BY c.created_at DESC LIMIT ${limit}`
    : sql`SELECT c.*,u.display_name author,u.avatar_url avatar FROM media_clips c LEFT JOIN users u ON u.id=c.submitted_by WHERE c.moderation_status='approved' ORDER BY c.created_at DESC LIMIT ${limit}`;
}

export async function addClip(
  userId: number,
  title: string,
  description: string,
  url: string,
  tour: TourCode | null,
  moderation: { status?: string; reason?: string | null; privatePathname?: string | null; privateContentType?: string | null } = {},
) {
  const rows = await sql`
    INSERT INTO media_clips(submitted_by,title,description,url,tour,moderation_status,moderation_reason,private_blob_pathname,private_blob_content_type)
    VALUES (${userId},${title},${description},${url},${tour},${moderation.status || 'approved'},${moderation.reason || null},${moderation.privatePathname || null},${moderation.privateContentType || null})
    RETURNING *
  `;
  return rows[0];
}

export async function deleteClip(id: number) {
  return sql`DELETE FROM media_clips WHERE id=${id}`;
}

/** Extracts a YouTube video id from common URL shapes so it can be embedded, otherwise null. */
export function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}
