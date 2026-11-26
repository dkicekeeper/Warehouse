import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readSession, sealSession, SESSION_COOKIE, SESSION_DAYS } from '@/lib/auth/session';

const STATE_COOKIE = 'wh_state';
const STATE_SECONDS = 600;

export interface AuthConfig {
  /** Client id and secret of the GitHub App (its "user authorization" side). */
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  /** Numeric id of the one GitHub account allowed in. */
  ownerGithubId: string;
  baseUrl: string;
  now: Date;
  fetchImpl?: typeof fetch;
}

const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function redirect(to: string, cookies: string[], status = 302): Response {
  const headers = new Headers({ location: to });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status, headers });
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The real access check, done next to the data: a valid session for the configured owner. */
export function isOwnerRequest(req: Request, config: Pick<AuthConfig, 'sessionSecret' | 'ownerGithubId' | 'now'>): boolean {
  if (!config.ownerGithubId) return false;
  const value = readCookie(req, SESSION_COOKIE);
  return value !== null && readSession(value, config.sessionSecret, config.now) === config.ownerGithubId;
}

/** Starts sign-in: off to GitHub, with a one-time state kept in a cookie to recognise the way back. */
export function handleLogin(config: AuthConfig): Response {
  if (!config.clientId || !config.clientSecret || !config.sessionSecret || !config.ownerGithubId) {
    return new Response('Вход не настроен', { status: 503 });
  }
  const state = randomBytes(24).toString('base64url');
  const to = new URL('https://github.com/login/oauth/authorize');
  to.searchParams.set('client_id', config.clientId);
  to.searchParams.set('redirect_uri', `${config.baseUrl}/auth/callback`);
  to.searchParams.set('state', state);
  return redirect(to.toString(), [cookie(STATE_COOKIE, state, STATE_SECONDS)]);
}

/**
 * GitHub sends the browser back here. The code is exchanged for a token, the token says who signed
 * in, and only the configured owner leaves with a session. Everyone else, and every failure,
 * goes back to the sign-in page with nothing.
 */
export async function handleCallback(req: Request, config: AuthConfig): Promise<Response> {
  const denied = () => redirect(`${config.baseUrl}/login?denied=1`, [cookie(STATE_COOKIE, '', 0)]);
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = readCookie(req, STATE_COOKIE);
  if (!code || !state || !expected || !same(state, expected)) return denied();

  const fetchImpl = config.fetchImpl ?? fetch;
  try {
    const tokenRes = await fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: `${config.baseUrl}/auth/callback`,
      }),
    });
    const token = ((await tokenRes.json()) as { access_token?: unknown }).access_token;
    if (typeof token !== 'string' || !token) return denied();

    const userRes = await fetchImpl('https://api.github.com/user', {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'warehouse-dispatch' },
    });
    if (!userRes.ok) return denied();
    const id = ((await userRes.json()) as { id?: unknown }).id;
    if ((typeof id !== 'number' && typeof id !== 'string') || !config.ownerGithubId || String(id) !== config.ownerGithubId) {
      return denied();
    }
    return redirect(`${config.baseUrl}/`, [
      cookie(SESSION_COOKIE, sealSession(String(id), config.sessionSecret, config.now), SESSION_DAYS * 86_400),
      cookie(STATE_COOKIE, '', 0),
    ]);
  } catch {
    return denied();
  }
}

export function handleSignout(config: Pick<AuthConfig, 'baseUrl'>): Response {
  return redirect(`${config.baseUrl}/login`, [cookie(SESSION_COOKIE, '', 0)], 303);
}
