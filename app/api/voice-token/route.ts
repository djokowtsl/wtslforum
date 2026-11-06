import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  createVoiceRoomSignature,
  isValidVoiceRoom,
  normalizeVoiceRoomName,
  VOICE_ROOM_TOKEN_TTL_SECONDS,
} from '@/lib/voiceRoomToken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = {
  'Cache-Control': 'no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Vary: 'Cookie',
};

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Log in to join the voice room.' }, {
      status: 401,
      headers: privateHeaders,
    });
  }
  if (!user.isAdmin) {
    return NextResponse.json({ error: 'Voice rooms are not available.' }, {
      status: 403,
      headers: privateHeaders,
    });
  }

  const room = (new URL(request.url).searchParams.get('room') || '').toLowerCase();
  if (!isValidVoiceRoom(room)) {
    return NextResponse.json({ error: 'Invalid voice room.' }, {
      status: 400,
      headers: privateHeaders,
    });
  }

  const secret = process.env.VOICE_ROOM_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    return NextResponse.json({ error: 'Voice rooms are not configured.' }, {
      status: 503,
      headers: privateHeaders,
    });
  }

  const name = normalizeVoiceRoomName(user.username);
  const exp = Math.floor(Date.now() / 1000) + VOICE_ROOM_TOKEN_TTL_SECONDS;
  const sig = createVoiceRoomSignature(secret, room, exp, name);
  return NextResponse.json({ name, exp, sig }, { headers: privateHeaders });
}
