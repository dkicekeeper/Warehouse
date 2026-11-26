import { describe, expect, it } from 'vitest';
import type { StoredItem } from '@/lib/domain/items';
import { buildBoardView } from '@/lib/domain/board';
import { DEFAULT_SETTINGS as CFG } from '@/lib/domain/types';
import type { SourceHealth } from '@/lib/store/store';
import { NOW, minutesAgo, pr, project, repo, run, session, snapshot } from '../helpers/factories';

const EMPTY_QUEUE = { running: 0, waiting: 0, freeSlotInMin: 0, rows: [] };

const item = (over: Partial<StoredItem> = {}): StoredItem => ({
  id: 'i1',
  key: 'k1',
  kind: 'session_needs_owner',
  level: 'request',
  projectId: 'p1',
  text: 'смержить',
  sessionId: 'session_a',
  pr: null,
  repo: 'o/r',
  since: minutesAgo(30),
  status: 'open',
  firstSeenAt: minutesAgo(30),
  snoozedUntil: null,
  dismissedText: null,
  notifiedAt: minutesAgo(29),
  notifiedText: null,
  telegramMessageId: null,
  resolvedAt: null,
  ...over,
});

const healthy: SourceHealth[] = [
  { source: 'github_webhook', lastOkAt: minutesAgo(3), lastErrorAt: null, note: null },
  { source: 'github_resync', lastOkAt: minutesAgo(10), lastErrorAt: null, note: null },
  { source: 'reconcile', lastOkAt: minutesAgo(50), lastErrorAt: null, note: null },
];

const view = (
  snap: Parameters<typeof snapshot>[0] = {},
  items: StoredItem[] = [],
  sources: SourceHealth[] = healthy,
) => buildBoardView(snapshot(snap), items, EMPTY_QUEUE, sources, NOW, CFG);

describe('attention block', () => {
  it('shows open items with project, age and links', () => {
    const v = view({}, [item({ pr: { repo: 'o/r', number: 3 } })]);
    expect(v.attention).toEqual([
      {
        id: 'i1',
        level: 'request',
        kind: 'session_needs_owner',
        project: 'Tenra',
        text: 'смержить',
        ageMin: 30,
        fresh: false,
        sessionUrl: 'https://claude.ai/code/session_a',
        prUrl: 'https://github.com/o/r/pull/3',
      },
    ]);
  });

  it('hides dismissed and snoozed items but counts the snoozed', () => {
    const v = view({}, [item({ id: 'a', status: 'dismissed' }), item({ id: 'b', status: 'snoozed' }), item({ id: 'c' })]);
    expect(v.attention.map((a) => a.id)).toEqual(['c']);
    expect(v.snoozed).toBe(1);
  });

  it('puts requests above notes, not-yet-notified first, then newest first', () => {
    const v = view({}, [
      item({ id: 'old', since: minutesAgo(900) }),
      item({ id: 'note-new', level: 'note', since: minutesAgo(1), notifiedAt: null }),
      item({ id: 'recent', since: minutesAgo(20) }),
      item({ id: 'fresh', since: minutesAgo(300), notifiedAt: null }),
      item({ id: 'note-old', level: 'note', since: minutesAgo(500) }),
    ]);
    expect(v.attention.map((a) => a.id)).toEqual(['fresh', 'recent', 'old', 'note-new', 'note-old']);
    expect(v.attention[0]?.fresh).toBe(true);
  });

  it('gives a local session no web link and an orphan item the «Без проекта» label', () => {
    const [a] = view({}, [item({ sessionId: 'c0ffee-uuid', projectId: null })]).attention;
    expect(a).toMatchObject({ sessionUrl: null, project: 'Без проекта' });
  });
});

describe('projects block', () => {
  it('groups sessions, PRs and runs under their project and counts what waits', () => {
    const s = session({ id: 'session_a', state: 'working', stateText: 'жду CI', title: 'Маркетинг', reportedAt: minutesAgo(12) });
    const p = pr({ number: 3, title: 'InfoTip', checks: 'pending', mergeable: null, updatedAt: minutesAgo(45) });
    const r = run({ id: 9, workflow: 'CI', createdAt: minutesAgo(50) });
    const v = view({ sessions: [s], prs: [p], runs: [r] }, [item()]);
    expect(v.projects).toHaveLength(1);
    expect(v.projects[0]).toMatchObject({
      id: 'p1',
      name: 'Tenra',
      waiting: 1,
      sessions: [
        {
          id: 'session_a',
          title: 'Маркетинг',
          state: 'working',
          stateText: 'жду CI',
          working: true,
          ageMin: 12,
          url: 'https://claude.ai/code/session_a',
        },
      ],
      prs: [
        {
          repo: 'o/r',
          number: 3,
          title: 'InfoTip',
          checks: 'pending',
          mergeable: null,
          draft: false,
          ageMin: 45,
          url: 'https://github.com/o/r/pull/3',
          ledBy: 'session',
          sessionId: 'session_a',
        },
      ],
      runs: [{ id: 9, workflow: 'CI', status: 'completed', conclusion: 'success', url: 'https://github.com/o/r/actions/runs/9' }],
    });
  });

  it('a PR is led by nobody when its session is not working any more', () => {
    const s = session({ state: 'done' });
    expect(view({ sessions: [s], prs: [pr()] }).projects[0]?.prs[0]).toMatchObject({ ledBy: 'none', sessionId: s.id });
    expect(view({ prs: [pr()] }).projects[0]?.prs[0]).toMatchObject({ ledBy: 'none', sessionId: null });
  });

  it('leaves out sessions quiet for over a week unless they have an open item', () => {
    const quiet = session({ id: 'session_q', reportedAt: minutesAgo(8 * 1440) });
    const asked = session({ id: 'session_k', reportedAt: minutesAgo(8 * 1440) });
    const v = view({ sessions: [quiet, asked] }, [item({ sessionId: 'session_k' })]);
    expect(v.projects[0]?.sessions.map((s) => s.id)).toEqual(['session_k']);
  });

  it('never shows archived sessions as project rows', () => {
    expect(view({ sessions: [session({ archived: true })] }).projects[0]?.sessions).toEqual([]);
  });

  it('keeps at most 5 recent runs per project, newest first', () => {
    const runs = Array.from({ length: 8 }, (_, i) => run({ id: i + 1, createdAt: minutesAgo(10 * (i + 1)) }));
    expect(view({ runs }).projects[0]?.runs.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('lists projects with waiting items first, then by name; sessions without a project go last', () => {
    const v = view(
      {
        projects: [project({ id: 'p1', name: 'Tenra' }), project({ id: 'p2', name: 'Dalada' }), project({ id: 'p3', name: 'Platina' })],
        repos: [repo(), repo({ fullName: 'o/d', projectId: 'p2' }), repo({ fullName: 'o/p', projectId: 'p3' })],
        sessions: [session({ projectId: null, repo: null, branch: null, title: 'Otbasy' })],
      },
      [item({ projectId: 'p3' })],
    );
    expect(v.projects.map((p) => p.name)).toEqual(['Platina', 'Dalada', 'Tenra', 'Без проекта']);
    expect(v.projects[3]?.id).toBeNull();
  });

  it('omits the «Без проекта» group when every session has a project', () => {
    expect(view({ sessions: [session()] }).projects.map((p) => p.name)).toEqual(['Tenra']);
  });
});

describe('source warnings', () => {
  it('is quiet when every source is healthy', () => {
    expect(view().warnings).toEqual([]);
  });

  it('warns when GitHub has not been resynced for over an hour', () => {
    const sources = healthy.map((s) => (s.source === 'github_resync' ? { ...s, lastOkAt: minutesAgo(61) } : s));
    expect(view({}, [], sources).warnings).toEqual(['GitHub не сверялся больше часа — данные о PR и сборках могут быть устаревшими']);
  });

  it('warns when the session reconcile is over two hours late', () => {
    const sources = healthy.map((s) => (s.source === 'reconcile' ? { ...s, lastOkAt: minutesAgo(121) } : s));
    expect(view({}, [], sources).warnings).toEqual(['Сверка сессий не приходила больше двух часов']);
  });

  it('warns when the last webhook result is an error, with its note', () => {
    const sources = healthy.map((s) =>
      s.source === 'github_webhook' ? { ...s, lastErrorAt: minutesAgo(1), note: '3 доставки не прошли' } : s,
    );
    expect(view({}, [], sources).warnings).toEqual(['Вебхуки GitHub: 3 доставки не прошли']);
  });

  it('warns when sessions stopped reporting through the hook', () => {
    const sources = [
      ...healthy,
      { source: 'session_hook' as const, lastOkAt: minutesAgo(300), lastErrorAt: minutesAgo(10), note: 'сессий обновилось без отчёта хука: 2' },
    ];
    expect(view({}, [], sources).warnings).toEqual(['Хук сессий: сессий обновилось без отчёта хука: 2']);
  });

  it('treats a source that never reported as late, except the session hook', () => {
    expect(view({}, [], []).warnings).toEqual([
      'GitHub не сверялся больше часа — данные о PR и сборках могут быть устаревшими',
      'Сверка сессий не приходила больше двух часов',
    ]);
  });
});

it('carries the queue through and stamps the time', () => {
  const v = view();
  expect(v.queue).toEqual({ ...EMPTY_QUEUE, rows: [] });
  expect(v.generatedAt).toBe(NOW.toISOString());
});
