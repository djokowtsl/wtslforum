import { NextResponse } from 'next/server'; import { getSession } from '@/lib/auth'; import { sql } from '@/lib/db';
export async function DELETE(req:Request){const u=await getSession();if(!u?.isAdmin)return NextResponse.json({error:'Forbidden'},{status:403});const b=await req.json();await sql`DELETE FROM replies WHERE id=${Number(b.id)}`;return NextResponse.json({ok:true})}
