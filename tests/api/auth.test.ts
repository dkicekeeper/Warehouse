import { describe, expect, it } from 'vitest';
import { handleCallback, handleLogin, handleSignout, isOwnerRequest, type AuthConfig } from '@/lib/api/auth';
import { sealSession } from '@/lib/auth/session';

const NOW = new Date('2026-11-26T07:00:00Z');
const config = (over: Partial<AuthConfig> = {}): AuthConfig => ({
  clientId: 'Iv1.abc',
  clientSecret: 'shh',
  sessionSecret: 's'.repeat(64),
  ownerGithubId: '11180079',
  baseUrl: 'https://w.example',
  now: NOW,
  fetchImpl: github({ id: 11180079 }),
  ...over,
});

function github(user: { id: number } | null, tokenStatus = 200): typeof fetch & { calls: { url: string; body: string | null; auth: string | null }[] } {
  const calls: { url: string; body: string | null; auth: string | null }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? String(init.body) : null, auth: new Headers(init?.headers).get('authorization') });
    if (url === 'https://github.com/login/oauth/access_token') {
      return Response.json(tokenStatus === 200 ? { access_token: 'gho_tok' } : { error: 'bad_verification_code' }, { status: 200 });
    }
    if (url === 'https://api.github.com/user') return user ? Response.json(user) : new Response('{}', { status: 401 });
    return new Response(null, { status: 404 });
  }) as typeof fetch & { calls: typeof calls };
  impl.calls = calls;
  return impl;
}

const cookieOf = (res: Response, name: string) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? null;
const valueOf = (res: Response, name: string) => cookieOf(res, name)?.split(';')[0]?.split('=').slice(1).join('=') ?? null;

describe('GET /auth/login', () => {
  it('sends the browser to GitHub with a fresh state, remembered in a short-lived cookie', () => {
    const res = handleLogin(config());
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location') ?? '');
    expect(to.origin + to.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(to.searchParams.get('client_id')).toBe('Iv1.abc');
    expect(to.searchParams.get('redirect_uri')).toBe('https://w.example/auth/callback');
    const state = to.searchParams.get('state') ?? '';
    expect(state.length).toBeGreaterThanOrEqual(32);
    const cookie = cookieOf(res, 'wh_state') ?? '';
    expect(cookie).toContain(`wh_state=${state}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Max-Age=600/i);
    expect(handleLogin(config()).headers.get('location')).not.toBe(res.headers.get('location'));
  });

  it('says so instead of redirecting when sign-in is not configured', () => {
    expect(handleLogin(config({ clientId: '' })).status).toBe(503);
  });
});

describe('GET /auth/callback', () => {
  const callback = (query: string, stateCookie: string | null, c = config()) =>
    handleCallback(
      new Request(`https://w.example/auth/callback${query}`, { headers: stateCookie ? { cookie: `wh_state=${stateCookie}` } : {} }),
      c,
    );

  it('the owner gets a signed 30-day session cookie and lands on the board', async () => {
    const c = config();
    const res = await callback('?code=abc&state=st4te', 'st4te', c);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://w.example/');
    const cookie = cookieOf(res, 'wh_session') ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(cookie).toMatch(/Path=\//);
    const again = new Request('https://w.example/api/board', { headers: { cookie: `wh_session=${valueOf(res, 'wh_session')}` } });
    expect(isOwnerRequest(again, c)).toBe(true);
    // The state cookie is spent.
    expect(cookieOf(res, 'wh_state')).toMatch(/Max-Age=0/);
  });

  it('exchanges the code with the app’s secret and reads the user with the token it got', async () => {
    const fetchImpl = github({ id: 11180079 });
    await callback('?code=abc&state=s', 's', config({ fetchImpl }));
    expect(fetchImpl.calls[0]).toMatchObject({ url: 'https://github.com/login/oauth/access_token' });
    expect(JSON.parse(fetchImpl.calls[0]?.body ?? '{}')).toEqual({
      client_id: 'Iv1.abc',
      client_secret: 'shh',
      code: 'abc',
      redirect_uri: 'https://w.example/auth/callback',
    });
    expect(fetchImpl.calls[1]).toMatchObject({ url: 'https://api.github.com/user', auth: 'Bearer gho_tok' });
  });

  it.each([
    ['another GitHub account', '?code=abc&state=s', 's', config({ fetchImpl: github({ id: 999 }) })],
    ['a state that does not match the cookie', '?code=abc&state=evil', 's', config()],
    ['no state cookie at all', '?code=abc&state=s', null, config()],
    ['no code', '?state=s', 's', config()],
    ['a code GitHub rejects', '?code=bad&state=s', 's', config({ fetchImpl: github({ id: 11180079 }, 400) })],
    ['a token GitHub does not recognise', '?code=abc&state=s', 's', config({ fetchImpl: github(null) })],
    ['GitHub being unreachable', '?code=abc&state=s', 's', config({ fetchImpl: (async () => { throw new Error('down'); }) as typeof fetch })],
  ])('%s gets no session and is sent back to sign-in', async (_n, query, state, c) => {
    const res = await callback(query, state, c);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://w.example/login?denied=1');
    expect(cookieOf(res, 'wh_session')).toBeNull();
  });

  it('does not call GitHub at all when the state is wrong', async () => {
    const fetchImpl = github({ id: 11180079 });
    await callback('?code=abc&state=evil', 's', config({ fetchImpl }));
    expect(fetchImpl.calls).toEqual([]);
  });
});

describe('isOwnerRequest', () => {
  const req = (cookie?: string) => new Request('https://w.example/api/board', { headers: cookie ? { cookie } : {} });
  const c = config();

  it('accepts only a valid session for the configured owner', () => {
    const good = sealSession('11180079', c.sessionSecret, NOW);
    expect(isOwnerRequest(req(`other=1; wh_session=${good}; x=y`), c)).toBe(true);
    expect(isOwnerRequest(req(`wh_session=${sealSession('999', c.sessionSecret, NOW)}`), c)).toBe(false);
    expect(isOwnerRequest(req('wh_session=forged'), c)).toBe(false);
    expect(isOwnerRequest(req(), c)).toBe(false);
  });

  it('a session sealed for a previous owner id stops working when the owner changes', () => {
    const cookie = `wh_session=${sealSession('11180079', c.sessionSecret, NOW)}`;
    expect(isOwnerRequest(req(cookie), config({ ownerGithubId: '42' }))).toBe(false);
    expect(isOwnerRequest(req(cookie), config({ ownerGithubId: '' }))).toBe(false);
  });
});

describe('POST /auth/signout', () => {
  it('clears the session cookie and returns to sign-in', () => {
    const res = handleSignout(config());
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://w.example/login');
    expect(cookieOf(res, 'wh_session')).toMatch(/Max-Age=0/);
  });
});
