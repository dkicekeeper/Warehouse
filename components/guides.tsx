'use client';

import { ArrowLeft, PenLine } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GuideView } from '@/lib/api/guides';
import { proposeUrl, type GuideRule } from '@/lib/domain/guides';
import { cn } from '@/lib/utils';
import { Chip, Notice, Page, link } from './page';
import { buttonVariants } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Skeleton } from './ui/skeleton';

interface GuidesResponse {
  intro: string;
  index: string;
  guides: GuideView[];
}

function useGuides() {
  const router = useRouter();
  const [data, setData] = useState<GuidesResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/guides', { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 401) return router.replace('/login');
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as GuidesResponse;
        if (alive) setData(body);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [router]);
  return { data, failed };
}

/** Markdown of the guides in the page's type and colours. */
const MD: Components = {
  h1: ({ children }) => <h2 className="text-lg font-semibold">{children}</h2>,
  h2: ({ children }) => <h2 className="mt-4 text-base font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-3 text-sm font-semibold">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-2 text-sm font-medium">{children}</h4>,
  p: ({ children }) => <p className="text-sm leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 text-sm">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5 text-sm">{children}</ol>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className={link}>
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed [&_code]:bg-transparent [&_code]:p-0">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b py-1 pr-3 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b py-1 pr-3 align-top">{children}</td>,
};

function Md({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

/** «в docs/ есть…» after «Правило:» reads as a sentence on its own: capital first letter. */
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A guide's first paragraph as a card's plain summary: no label, no code marks. */
const summary = (intro: string) => sentence(intro.replace(/^Как это устроено:\s*/, '').replace(/`/g, ''));

function AutoCount({ n }: { n: number }) {
  return <span className={n > 0 ? 'text-success' : undefined}>{n} автоматически</span>;
}

function ProposeLink({ rule, guide, label = 'Предложить правку' }: { rule: GuideRule | null; guide: GuideView; label?: string }) {
  return (
    <a
      data-testid="propose"
      href={proposeUrl(rule, guide, today())}
      target="_blank"
      rel="noreferrer"
      className={buttonVariants({ variant: 'outline', size: 'sm' })}
    >
      <PenLine aria-hidden />
      {label}
    </a>
  );
}

export function Guides() {
  const { data, failed } = useGuides();
  const slug = useSearchParams().get('g');
  const guide = slug ? (data?.guides.find((g) => g.slug === slug) ?? null) : null;

  if (guide) return <GuideDetail guide={guide} />;
  return (
    <Page title="Гайдлайны" wide>
      {failed && <Notice tone="error">Не удалось загрузить гайдлайны. Обновите страницу.</Notice>}
      {!data && !failed && <Skeleton className="h-64 w-full rounded-xl" />}
      {data && (
        <>
          <Md className="max-w-3xl text-muted-foreground">{data.intro}</Md>
          <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.guides.map((g) => (
              <Link key={g.slug} href={`/guides?g=${g.slug}`} data-testid="guide-card" className="group">
                <Card size="sm" className="h-full transition-colors group-hover:bg-muted/40">
                  <CardContent className="flex flex-col gap-2 py-4">
                    <h2 className="text-base font-medium">{g.title}</h2>
                    <p className="line-clamp-3 text-sm text-muted-foreground">{summary(g.intro)}</p>
                    <p className="text-xs text-muted-foreground">
                      {g.counts.rules} {g.counts.rules === 1 ? 'правило' : g.counts.rules < 5 ? 'правила' : 'правил'} ·{' '}
                      <AutoCount n={g.counts.auto} /> · {g.counts.auditOnly} на аудите
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          <details className="max-w-3xl rounded-xl border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">Как устроены правила и как предложить изменение</summary>
            <Md className="pt-3">{data.index.replace(/^# .*\n/, '').replace(/## Гайдлайны по порядку[\s\S]*?(?=\n## )/, '')}</Md>
          </details>
        </>
      )}
    </Page>
  );
}

function GuideDetail({ guide }: { guide: GuideView }) {
  return (
    <Page
      title={guide.title}
      aside={
        <Link href="/guides" className={cn('inline-flex items-center gap-1', link)}>
          <ArrowLeft className="size-3.5" aria-hidden />
          Все гайдлайны
        </Link>
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {guide.counts.rules} правил · <AutoCount n={guide.counts.auto} /> · {guide.counts.auditOnly} на аудите
        </span>
        <span className="ml-auto">
          <ProposeLink rule={null} guide={guide} label="Предложить правку гайдлайна" />
        </span>
      </div>
      {guide.blocks.map((b, i) =>
        b.kind === 'text' ? <Md key={i}>{b.text}</Md> : <RuleCard key={b.rule.id} rule={b.rule} guide={guide} />,
      )}
      {guide.agentPart && (
        <details className="rounded-xl border px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">Что получает агент в CLAUDE.md проектов</summary>
          <Md className="pt-3">{guide.agentPart}</Md>
        </details>
      )}
    </Page>
  );
}

function RuleCard({ rule, guide }: { rule: GuideRule; guide: GuideView }) {
  return (
    <Card size="sm" id={rule.id} data-testid="rule-card" className="scroll-mt-4">
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <Chip tone="plain">
            <span className="font-mono">{rule.id}</span>
          </Chip>
          <h3 className="text-sm font-medium">{rule.title}</h3>
        </div>
        <Md>{sentence(rule.text)}</Md>
        {rule.why && <Md className="text-muted-foreground">{`Почему: ${rule.why}`}</Md>}
        <div className="flex flex-wrap items-center gap-1.5">
          {rule.checks.length === 0 && <Chip tone="plain">проверка не указана</Chip>}
          {rule.checks.map((c) => (
            <Chip key={c.label} tone={c.kind === 'auto' ? 'good' : 'plain'}>
              {c.kind === 'auto' ? `автоматически: ${c.label.replace(/`/g, '')}` : 'на аудите'}
            </Chip>
          ))}
          {rule.where && <Chip tone="plain">где: {rule.where}</Chip>}
          {rule.agent && <Chip tone="plain">в блоке агента</Chip>}
          <span className="ml-auto">
            <ProposeLink rule={rule} guide={guide} />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
