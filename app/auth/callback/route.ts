import { NextResponse } from 'next/server';
import { isOwnerUser } from '@/lib/auth/owner';
import { supabaseServer } from '@/lib/auth/server';

/** GitHub sends the browser back here. Anyone but the owner is signed straight out again. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const supabase = await supabaseServer();
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && isOwnerUser(data.user, process.env.OWNER_GITHUB_ID ?? '')) {
      return NextResponse.redirect(new URL('/', url.origin));
    }
  }
  await supabase.auth.signOut().catch(() => {});
  return NextResponse.redirect(new URL('/login?denied=1', url.origin));
}
