import { describe, expect, it } from 'vitest';
import { readSession, sealSession, SESSION_DAYS } from '@/lib/auth/session';

const SECRET = 'a'.repeat(64);
const NOW = new Date('2026-11-26T07:00:00Z');
const later = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

describe('session cookie', () => {
  it('round-trips the GitHub id it was sealed with', () => {
    expect(readSession(sealSession('11180079', SECRET, NOW), SECRET, NOW)).toBe('11180079');
  });

  it('lasts 30 days and not a second longer', () => {
    const cookie = sealSession('1', SECRET, NOW);
    expect(SESSION_DAYS).toBe(30);
    expect(readSession(cookie, SECRET, later(29.9))).toBe('1');
    expect(readSession(cookie, SECRET, later(30.01))).toBeNull();
  });

  it('rejects a cookie signed with another secret', () => {
    expect(readSession(sealSession('1', 'b'.repeat(64), NOW), SECRET, NOW)).toBeNull();
  });

  it('rejects a cookie whose payload was edited', () => {
    const [payload, sig] = sealSession('1', SECRET, NOW).split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ sub: '2', exp: Date.now() / 1000 + 9999 })).toString('base64url');
    expect(readSession(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
    expect(readSession(`${payload}.${sig.slice(0, -2)}xx`, SECRET, NOW)).toBeNull();
  });

  it.each(['', 'x', 'a.b', 'a.b.c', '..', 'e30.', '.e30'])('rejects garbage %j', (value) => {
    expect(readSession(value, SECRET, NOW)).toBeNull();
  });

  it('rejects everything when no secret is configured, and refuses to seal', () => {
    expect(readSession(sealSession('1', SECRET, NOW), '', NOW)).toBeNull();
    expect(() => sealSession('1', '', NOW)).toThrow();
  });

  it('rejects a short secret outright: a guessable key is no key', () => {
    expect(() => sealSession('1', 'short', NOW)).toThrow();
    expect(readSession('x.y', 'short', NOW)).toBeNull();
  });
});
