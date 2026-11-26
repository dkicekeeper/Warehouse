import { timingSafeEqual } from 'node:crypto';

/** True when the request carries exactly the expected bearer token. No token configured: never. */
export function verifyBearer(req: Request, expected: string): boolean {
  if (!expected) return false;
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
  if (!m?.[1]) return false;
  const given = Buffer.from(m[1], 'utf8');
  const want = Buffer.from(expected, 'utf8');
  return given.length === want.length && timingSafeEqual(given, want);
}
