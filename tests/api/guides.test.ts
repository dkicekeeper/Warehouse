import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleGuides } from '@/lib/api/guides';

const owner = (yes: boolean) => ({ isOwner: async () => yes });

describe('GET /api/guides', () => {
  it('answers anyone else with an empty 401', async () => {
    const res = await handleGuides(owner(false));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('');
  });

  it('gives the guides of standard/guides in the order of their index, with the counts of rules and checks', async () => {
    const res = await handleGuides(owner(true));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.guides.map((g: { slug: string }) => g.slug)).toEqual([
      'projects', 'docs', 'sessions', 'ci', 'security', 'release', 'design', 'audit',
    ]);
    const docs = body.guides[1];
    expect(docs.title).toBe('Документы');
    expect(docs.rules.length).toBeGreaterThan(5);
    expect(docs.counts.rules).toBe(docs.rules.length);
    expect(docs.counts.auto + docs.counts.auditOnly).toBe(docs.rules.length);
    expect(body.intro).toContain('Общие правила всех проектов владельца');
  });

  it('a folder without guides gives an empty list, not an error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wh-noguides-'));
    mkdirSync(join(dir, 'guides'));
    writeFileSync(join(dir, 'guides', 'README.md'), '# Гайдлайны\n\nПусто.\n');
    const res = await handleGuides(owner(true), join(dir, 'guides'));
    expect((await res.json()).guides).toEqual([]);
  });
});
