import { createHmac, timingSafeEqual } from 'node:crypto';

// `__Host-`: the browser accepts it only over HTTPS, for this exact host, with Path=/ —
// a sibling subdomain cannot plant or overwrite it.
export const SESSION_COOKIE = '__Host-wh_session';
export const SESSION_DAYS = 30;
const MIN_SECRET_CHARS = 32;

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

/**
 * The owner's session: `<payload>.<HMAC>`, where the payload names the GitHub account id that
 * signed in and when the session ends. Nothing is stored server-side; the signature is the proof.
 */
export function sealSession(githubId: string, secret: string, now: Date): string {
  if (secret.length < MIN_SECRET_CHARS) throw new Error('SESSION_SECRET is missing or too short');
  const exp = Math.floor(now.getTime() / 1000) + SESSION_DAYS * 86_400;
  const payload = Buffer.from(JSON.stringify({ sub: githubId, iat: now.getTime(), exp })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** Who a valid, unexpired session cookie belongs to and when it was issued; null for anything else. */
export function readSession(cookie: string, secret: string, now: Date): { sub: string; issuedAt: Date } | null {
  if (secret.length < MIN_SECRET_CHARS) return null;
  const parts = cookie.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts as [string, string];
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: unknown; iat?: unknown; exp?: unknown };
    if (typeof data.sub !== 'string' || typeof data.exp !== 'number' || typeof data.iat !== 'number') return null;
    return data.exp * 1000 > now.getTime() ? { sub: data.sub, issuedAt: new Date(data.iat) } : null;
  } catch {
    return null;
  }
}
