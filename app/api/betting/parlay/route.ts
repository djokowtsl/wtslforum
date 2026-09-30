import {NextResponse} from 'next/server';
import {getSession} from '@/lib/auth';

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      {error: 'Sign in with Discord first'},
      {status: 401},
    );
  }

  return NextResponse.json(
    {
      error:
        'Parlay placement is temporarily unavailable while the WTSL Core API is read-only.',
    },
    {status: 501},
  );
}
