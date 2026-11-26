import type { BoardResponse } from '@/lib/domain/overview';

const session = (id: string) => `https://claude.ai/code/session_${id}`;

/** A busy afternoon: what the owner's board looked like on the day the service was designed. */
export const BOARD: BoardResponse = {
  generatedAt: new Date().toISOString(),
  snoozed: 1,
  warnings: [],
  attention: [
    { id: 'i1', level: 'request', kind: 'pr_ready', project: 'Platina', text: 'PR #3 Add an InfoTip to trophy rarity — готов к мержу', ageMin: 540, fresh: true, sessionUrl: session('a'), prUrl: 'https://github.com/dkicekeeper/Platina/pull/3' },
    { id: 'i2', level: 'request', kind: 'session_needs_owner', project: 'DesignKit', text: 'посмотреть галерею компонентов в сборке 8.18.1 и сказать, что править', ageMin: 30, fresh: false, sessionUrl: session('b'), prUrl: null },
    { id: 'i3', level: 'request', kind: 'session_needs_owner', project: 'Baja.kz', text: 'PR #13 и #14 — решения по расхождениям в админке', ageMin: 13 * 1440, fresh: false, sessionUrl: session('c'), prUrl: null },
    { id: 'i4', level: 'note', kind: 'session_reconcile', project: 'Tenra', text: 'разблокировать телефон и поставить автоблокировку на «Никогда», затем сказать сессии', ageMin: 7 * 1440, fresh: false, sessionUrl: null, prUrl: null },
  ],
  queue: {
    running: 2,
    waiting: 3,
    freeSlotInMin: 62,
    rows: [
      { jobId: 1, runId: 101, repo: 'dkicekeeper/Dalada', workflow: 'TestFlight', branch: 'main', status: 'in_progress', stale: false, elapsedMin: 31, estimateMin: 50, waitingMin: null, startsInMin: null, sessionId: null, origin: 'manual', project: 'Dalada', sessionTitle: null, sessionUrl: null, runUrl: 'https://github.com/dkicekeeper/Dalada/actions/runs/101' },
      { jobId: 2, runId: 102, repo: 'dkicekeeper/Tenra', workflow: 'CI', branch: 'claude/paywall-gates-x7', status: 'in_progress', stale: false, elapsedMin: 18, estimateMin: 40, waitingMin: null, startsInMin: null, sessionId: 'session_d', origin: 'session', project: 'Tenra', sessionTitle: 'Tenra Маркетинг', sessionUrl: session('d'), runUrl: 'https://github.com/dkicekeeper/Tenra/actions/runs/102' },
      { jobId: 3, runId: 103, repo: 'dkicekeeper/Platina', workflow: 'iOS', branch: 'claude/infotip-a1', status: 'queued', stale: false, elapsedMin: null, estimateMin: 25, waitingMin: 70, startsInMin: 19, sessionId: 'session_a', origin: 'session', project: 'Platina', sessionTitle: 'Add an InfoTip to Platina’s trophy rarity', sessionUrl: session('a'), runUrl: 'https://github.com/dkicekeeper/Platina/actions/runs/103' },
      { jobId: 4, runId: 104, repo: 'dkicekeeper/Tenra', workflow: 'CI', branch: 'claude/paywall-gates-x7', status: 'queued', stale: true, elapsedMin: null, estimateMin: 40, waitingMin: 44, startsInMin: 22, sessionId: 'session_d', origin: 'session', project: 'Tenra', sessionTitle: 'Tenra Маркетинг', sessionUrl: session('d'), runUrl: 'https://github.com/dkicekeeper/Tenra/actions/runs/104' },
      { jobId: 5, runId: 105, repo: 'dkicekeeper/DesignKit', workflow: 'Screenshots', branch: 'main', status: 'queued', stale: false, elapsedMin: null, estimateMin: null, waitingMin: 12, startsInMin: null, sessionId: null, origin: 'schedule', project: 'DesignKit', sessionTitle: null, sessionUrl: null, runUrl: 'https://github.com/dkicekeeper/DesignKit/actions/runs/105' },
    ],
  },
  projects: [
    {
      id: 'p-platina', name: 'Platina', waiting: 1,
      sessions: [{ id: 'session_a', title: 'Add an InfoTip to Platina’s trophy rarity', state: 'needs_owner', stateText: 'смержить PR #3', working: false, ageMin: 540, url: session('a') }],
      prs: [{ repo: 'dkicekeeper/Platina', number: 3, title: 'Add an InfoTip to trophy rarity', checks: 'success', mergeable: true, draft: false, ageMin: 540, url: 'https://github.com/dkicekeeper/Platina/pull/3', ledBy: 'none', sessionId: 'session_a' }],
      runs: [{ id: 103, repo: 'dkicekeeper/Platina', workflow: 'iOS', branch: 'claude/infotip-a1', status: 'queued', conclusion: null, ageMin: 70, url: 'https://github.com/dkicekeeper/Platina/actions/runs/103' }],
    },
    {
      id: 'p-tenra', name: 'Tenra', waiting: 0,
      sessions: [
        { id: 'session_d', title: 'Tenra Маркетинг', state: 'working', stateText: 'жду CI', working: true, ageMin: 18, url: session('d') },
        { id: 'session_e', title: 'Продвижение застопорилось', state: 'working', stateText: 'жду данных за неделю', working: false, ageMin: 2 * 1440, url: session('e') },
        { id: 'c0ffee00-local', title: 'Прототип по §14 gamification', state: 'unknown', stateText: '', working: false, ageMin: 7 * 1440, url: null },
      ],
      prs: [
        { repo: 'dkicekeeper/Tenra', number: 171, title: 'Paywall gates in Russian and Kazakh', checks: 'pending', mergeable: null, draft: false, ageMin: 18, url: 'https://github.com/dkicekeeper/Tenra/pull/171', ledBy: 'session', sessionId: 'session_d' },
        { repo: 'dkicekeeper/Tenra', number: 169, title: 'Usage events: first pass', checks: 'failure', mergeable: false, draft: true, ageMin: 3 * 1440, url: 'https://github.com/dkicekeeper/Tenra/pull/169', ledBy: 'none', sessionId: null },
      ],
      runs: [
        { id: 104, repo: 'dkicekeeper/Tenra', workflow: 'CI', branch: 'claude/paywall-gates-x7', status: 'queued', conclusion: null, ageMin: 44, url: 'https://github.com/dkicekeeper/Tenra/actions/runs/104' },
        { id: 102, repo: 'dkicekeeper/Tenra', workflow: 'CI', branch: 'claude/paywall-gates-x7', status: 'in_progress', conclusion: null, ageMin: 20, url: 'https://github.com/dkicekeeper/Tenra/actions/runs/102' },
        { id: 99, repo: 'dkicekeeper/Tenra', workflow: 'CI', branch: 'main', status: 'completed', conclusion: 'success', ageMin: 300, url: 'https://github.com/dkicekeeper/Tenra/actions/runs/99' },
      ],
    },
    { id: 'p-dalada', name: 'Dalada', waiting: 0, sessions: [], prs: [], runs: [] },
    { id: null, name: 'Без проекта', waiting: 0, sessions: [{ id: 'session_f', title: 'Otbasy', state: 'unknown', stateText: '', working: false, ageMin: 2 * 1440, url: session('f') }], prs: [], runs: [] },
  ],
};

/** Two weeks of macOS builds: Tenra and Dalada most days, Platina now and then. */
BOARD.macBuilds = {
  projects: ['Tenra', 'Dalada', 'Platina', 'DesignKit'],
  days: Array.from({ length: 14 }, (_, i) => ({
    date: `2026-11-${String(13 + i).padStart(2, '0')}`,
    label: `${String(13 + i).padStart(2, '0')}.11`,
    minutes: { Tenra: 40 + ((i * 37) % 90), Dalada: i % 3 === 0 ? 0 : 25 + ((i * 13) % 40), Platina: i % 4 === 1 ? 35 : 0, DesignKit: i % 5 === 2 ? 20 : 0 },
    waitMin: (i * 17) % 60,
  })),
};

export const EMPTY_BOARD: BoardResponse = {
  generatedAt: new Date().toISOString(),
  snoozed: 0,
  warnings: ['GitHub не сверялся больше часа — данные о PR и сборках могут быть устаревшими'],
  attention: [],
  queue: { running: 0, waiting: 0, freeSlotInMin: 0, rows: [] },
  projects: [],
};
