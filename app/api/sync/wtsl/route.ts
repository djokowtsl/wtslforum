import {NextRequest,NextResponse} from 'next/server';
import {syncTournaments} from '@/lib/tournaments';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
  const external=req.headers.get('x-wtsl-sync-secret');
  const cron=req.headers.get('authorization');
  const authorized=(process.env.WTSL_SYNC_SECRET && external===process.env.WTSL_SYNC_SECRET) || (process.env.CRON_SECRET && cron===`Bearer ${process.env.CRON_SECRET}`);
  if(!authorized) return NextResponse.json({error:'Unauthorized'},{status:401});
  try { return NextResponse.json({ok:true,...await syncTournaments()}); }
  catch(e){ return NextResponse.json({error:e instanceof Error?e.message:'Sync failed'},{status:500}); }
}
