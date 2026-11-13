import { NextRequest, NextResponse } from 'next/server';
import { isForumMaintenanceActive } from './lib/dmoCommentaryMaintenance.mjs';

export function proxy(request: NextRequest) {
  if (!isForumMaintenanceActive() || request.nextUrl.pathname === '/maintenance') {
    return NextResponse.next();
  }

  const destination = request.nextUrl.clone();
  destination.pathname = '/maintenance';
  destination.search = '';
  const response = NextResponse.rewrite(destination);
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
