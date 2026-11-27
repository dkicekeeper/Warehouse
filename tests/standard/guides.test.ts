import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseGuide } from '@/lib/domain/guides';

const DIR = join(process.cwd(), 'standard', 'guides');
const PREFIX: Record<string, string> = {
  projects: 'PRJ', docs: 'DOC', sessions: 'SES', ci: 'CI', security: 'SEC', release: 'REL', design: 'DES', audit: 'AUD',
};
const files = readdirSync(DIR).filter((f) => f.endsWith('.md') && f !== 'README.md');
const guides = files.map((f) => parseGuide(f.replace(/\.md$/, ''), readFileSync(join(DIR, f), 'utf8')));

describe('standard/guides', () => {
  it('has the eight guides the index lists, in its order', () => {
    const index = readFileSync(join(DIR, 'README.md'), 'utf8');
    const listed = [...index.matchAll(/^\d+\. \[[^\]]+\]\(([a-z-]+)\.md\)/gm)].map((m) => m[1]);
    expect(listed).toEqual(Object.keys(PREFIX));
    expect(files.map((f) => f.replace(/\.md$/, '')).sort()).toEqual([...listed].sort());
  });

  it.each(Object.entries(PREFIX))('%s: numbered rules with its prefix, a text, a check and a place', (slug, prefix) => {
    const g = guides.find((x) => x.slug === slug)!;
    expect(g.intro.startsWith('Как это устроено:')).toBe(true);
    expect(g.rules.length).toBeGreaterThan(0);
    expect(g.agentPart.length).toBeGreaterThan(0);
    for (const r of g.rules) {
      expect(r.id.startsWith(`${prefix}-`), r.id).toBe(true);
      expect(r.text, r.id).not.toBe('');
      expect(r.checks.length, r.id).toBeGreaterThan(0);
      expect(r.where, r.id).not.toBeNull();
    }
    const numbers = g.rules.map((r) => Number(r.id.split('-')[1]));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it('every rule meant for the agent is named in its guide agent part', () => {
    for (const g of guides) for (const r of g.rules.filter((x) => x.agent)) expect(g.agentPart, r.id).toContain(r.id);
  });
});
