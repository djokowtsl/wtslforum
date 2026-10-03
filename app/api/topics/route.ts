import { NextResponse } from 'next/server'; import { getSession } from '@/lib/auth'; import { sql } from '@/lib/db'; import { announceTopic } from '@/lib/discord'; import { claimMatchThread } from '@/lib/matchThreads';
import { isTourCode } from '@/lib/wtsl';
const slugify=(s:string)=>s.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90);
export async function POST(req:Request){const u=await getSession(); if(!u)return NextResponse.json({error:'Sign in with Discord first.'},{status:401}); const b=await req.json(); if(!b.title||!b.body||!b.categoryId)return NextResponse.json({error:'Title, category and post are required.'},{status:400}); const base=slugify(b.title); const rows=await sql`INSERT INTO topics(category_id,author_id,title,slug,body) VALUES (${Number(b.categoryId)},${Number(u.id)},${b.title.trim()},${base+'-'+Date.now()},${b.body.trim()}) RETURNING id`; let id=Number(rows[0].id); let won=true;
  // A match's thread is "claimed" by whoever's first post actually lands here — if two people
  // wrote the first post for the same match at once, the loser's just-created (reply-less) topic
  // is thrown away and they're redirected into the winner's thread instead, so a match never ends
  // up with two competing threads (and doesn't get announced to Discord twice).
  if(b.matchKey){const winnerId=await claimMatchThread(String(b.matchKey),id,isTourCode(b.tour)?b.tour:null); if(winnerId!==id){await sql`DELETE FROM topics WHERE id=${id}`; id=winnerId; won=false;}}
  if(won) await announceTopic(b.title.trim(),id,u.username).catch(()=>{});
  return NextResponse.json({id},{status:201})}
