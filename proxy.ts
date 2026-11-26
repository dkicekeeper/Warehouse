import { NextResponse, type NextRequest } from 'next/server';

/**
 * An optimistic check only: no sign-in cookie, no point rendering the shell. The pages themselves
 * are static and carry no data; every byte of data comes from /api, where the cookie is verified
 * against Supabase and the owner's GitHub id.
 */
export function proxy(req: NextRequest) {
  const signedIn = req.cookies.getAll().some((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name));
  if (signedIn) return NextResponse.next();
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = {
  matcher: ['/((?!api/|auth/|login|_next/static|_next/image|favicon\\.ico).*)'],
};
