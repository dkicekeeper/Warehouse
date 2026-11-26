import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/auth/server';

export async function POST(req: Request): Promise<Response> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut().catch(() => {});
  return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
}
