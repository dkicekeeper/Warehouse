import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseGuide, type Guide } from '@/lib/domain/guides';

/**
 * The guidelines (`standard/guides/`) for the site's «Гайдлайны» section. The files are part of
 * this repository and of the deployed function (`outputFileTracingIncludes` in next.config.ts);
 * they are public anyway, but like every byte the service serves they go only to the owner.
 */

export interface GuideView extends Guide {
  counts: { rules: number; auto: number; auditOnly: number };
}

const DIR = join(process.cwd(), 'standard', 'guides');

const empty = (status: number) => new Response(null, { status });

function firstParagraph(markdown: string): string {
  const afterTitle = markdown.replace(/^# .*\n/, '').trim();
  return (afterTitle.split(/\n\s*\n/)[0] ?? '').trim();
}

export async function handleGuides(deps: { isOwner: () => Promise<boolean> }, dir = DIR): Promise<Response> {
  if (!(await deps.isOwner())) return empty(401);
  const index = await readFile(join(dir, 'README.md'), 'utf8');
  const files = [...index.matchAll(/^\d+\. \[[^\]]+\]\(([a-z-]+)\.md\)/gm)].map((m) => m[1] as string);
  const guides: GuideView[] = [];
  for (const slug of files) {
    const text = await readFile(join(dir, `${slug}.md`), 'utf8').catch(() => null);
    if (text === null) continue;
    const g = parseGuide(slug, text);
    const auto = g.rules.filter((r) => r.checks.some((c) => c.kind === 'auto')).length;
    guides.push({ ...g, counts: { rules: g.rules.length, auto, auditOnly: g.rules.length - auto } });
  }
  return Response.json(
    { intro: firstParagraph(index), index, guides },
    { headers: { 'cache-control': 'no-store' } },
  );
}
