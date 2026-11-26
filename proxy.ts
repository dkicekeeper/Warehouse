import { NextResponse, type NextRequest } from 'next/server';

/**
 * An optimistic check only: no sign-in cookie, no point rendering the shell. The pages themselves
 * are static and carry no data; every byte of data comes from /api, where the cookie's signature,
 * expiry and owner id are verified.
 */
export function proxy(req: NextRequest) {
  const signedIn = req.cookies.has('__Host-wh_session');
  if (signedIn) return NextResponse.next();
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = {
  matcher: ['/((?!api/|auth/|login|_next/static|_next/image|favicon\\.ico).*)'],
};
