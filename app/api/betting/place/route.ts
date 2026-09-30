import {NextResponse} from 'next/server';
import {placeBet} from '@/lib/betting';
import {getSession} from '@/lib/auth';
export async function POST(req:Request){
  try{
    const s=await getSession();
    if(!s)return NextResponse.json({error:'Sign in with Discord first'},{status:401});
    const b=await req.json();
    const bet=await placeBet(s.discordId,Number(b.fixtureId),String(b.selectionId),Number(b.stake));
    return NextResponse.json({bet});
  }catch(e:any){return NextResponse.json({error:e.message||'Bet failed'},{status:400});}
}
