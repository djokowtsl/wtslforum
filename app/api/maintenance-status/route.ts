import { NextResponse } from 'next/server';
import {
  isCommentaryRestrictionActive,
  isForumMaintenanceActive,
} from '@/lib/dmoCommentaryMaintenance.mjs';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    forumMaintenanceActive: isForumMaintenanceActive(),
    commentaryRestrictionActive: isCommentaryRestrictionActive(),
  }, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
