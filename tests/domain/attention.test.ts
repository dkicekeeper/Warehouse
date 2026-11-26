import { describe, expect, it } from 'vitest';
import { computeAttention, isWorking } from '@/lib/domain/attention';
import { DEFAULT_SETTINGS as CFG } from '@/lib/domain/types';
import { NOW, minutesAgo, pr, repo, run, session, snapshot } from '../helpers/factories';

const attention = (s: Parameters<typeof snapshot>[0]) => computeAttention(snapshot(s), NOW, CFG);
const kinds = (s: Parameters<typeof snapshot>[0]) => attention(s).map((i) => i.kind);

describe('isWorking', () => {
  it('expires after 120 min without a run', () => {
    const s = session({ state: 'working', reportedAt: minutesAgo(121) });
    expect(isWorking(s, [], NOW, CFG)).toBe(false);
    expect(isWorking({ ...s, reportedAt: minutesAgo(119) }, [], NOW, CFG)).toBe(true);
  });

  it('stays alive past the TTL while a run on its branch is queued or in progress', () => {
    const s = session({ state: 'working', repo: 'o/r', branch: 'claude/x', reportedAt: minutesAgo(500) });
    expect(isWorking(s, [run({ status: 'queued' })], NOW, CFG)).toBe(true);
    expect(isWorking(s, [run({ status: 'in_progress' })], NOW, CFG)).toBe(true);
    expect(isWorking(s, [run({ status: 'completed' })], NOW, CFG)).toBe(false);
    expect(isWorking(s, [run({ status: 'queued', branch: 'claude/other' })], NOW, CFG)).toBe(false);
    expect(isWorking(s, [run({ status: 'queued', repo: 'o/other' })], NOW, CFG)).toBe(false);
  });

  it('is false for other states and for archived sessions', () => {
    expect(isWorking(session({ state: 'done' }), [], NOW, CFG)).toBe(false);
    expect(isWorking(session({ state: 'needs_owner' }), [], NOW, CFG)).toBe(false);
    expect(isWorking(session({ state: 'working', archived: true }), [], NOW, CFG)).toBe(false);
  });
});

describe('a request the session has moved past', () => {
  // The hook can go quiet (the session restarted outside the repository): a request then stays
  // on the board for hours while the session pushes on. New builds on its branch give it away.
  const asking = () => session({ state: 'needs_owner', stateText: 'какие PR мержить', reportedAt: minutesAgo(420) });

  it('turns into a note once the session pushed again after asking', () => {
    const s = asking();
    const [item] = attention({ sessions: [s], runs: [run({ createdAt: minutesAgo(30) })] });
    expect(item).toMatchObject({
      kind: 'session_stale',
      level: 'note',
      text: 'отчёт устарел: «какие PR мержить», а сессия пушила позже',
      since: minutesAgo(30),
    });
  });

  it('stays a request when nothing happened on its branch after the report', () => {
    const s = asking();
    expect(kinds({ sessions: [s], runs: [run({ createdAt: minutesAgo(500) })] })).toEqual(['session_needs_owner']);
  });

  it('ignores builds a few minutes after the report: the push and the report end the same turn', () => {
    const s = session({ state: 'needs_owner', stateText: 'смержить PR #3', reportedAt: minutesAgo(20) });
    expect(kinds({ sessions: [s], runs: [run({ createdAt: minutesAgo(15) })] })).toEqual(['session_needs_owner']);
  });

  it('ignores builds of other branches, other repositories and scheduled runs', () => {
    const s = asking();
    const runs = [
      run({ createdAt: minutesAgo(30), branch: 'main' }),
      run({ createdAt: minutesAgo(30), repo: 'o/other' }),
      run({ createdAt: minutesAgo(30), event: 'schedule' }),
    ];
    expect(kinds({ sessions: [s], runs })).toEqual(['session_needs_owner']);
  });
});

describe('session items', () => {
  it('needs_owner → a request carrying the status text', () => {
    const s = session({ state: 'needs_owner', stateText: 'смержить PR #3', reportedAt: minutesAgo(9) });
    expect(attention({ sessions: [s] })).toEqual([
      {
        key: `session:${s.id}`,
        kind: 'session_needs_owner',
        level: 'request',
        projectId: 'p1',
        text: 'смержить PR #3',
        sessionId: s.id,
        pr: null,
        repo: 'o/r',
        since: minutesAgo(9),
      },
    ]);
  });

  it('done and live working sessions produce nothing', () => {
    expect(kinds({ sessions: [session({ state: 'done' }), session({ state: 'working' })] })).toEqual([]);
  });

  it('unknown with a hook report → a note prefixed «без статуса»', () => {
    const [item] = attention({ sessions: [session({ state: 'unknown', stateText: 'хвост' })] });
    expect(item).toMatchObject({ kind: 'session_unknown', level: 'note', text: 'без статуса: хвост' });
  });

  it('working past its TTL → a «сессия молчит» note', () => {
    const s = session({ state: 'working', stateText: 'жду CI', reportedAt: minutesAgo(200) });
    const [item] = attention({ sessions: [s] });
    expect(item).toMatchObject({ kind: 'session_silent', level: 'note', text: 'сессия молчит: жду CI' });
  });

  it('archived sessions produce nothing, whatever their hook state', () => {
    expect(kinds({ sessions: [session({ state: 'needs_owner', archived: true })] })).toEqual([]);
    expect(kinds({ sessions: [session({ state: 'unknown', archived: true })] })).toEqual([]);
  });
});

describe('reconcile items', () => {
  const rec = (bucket: 'working' | 'blocked' | 'review_ready' | 'completed' | 'failed', unread = false) => ({
    bucket,
    unread,
    summary: 'нужно разблокировать телефон',
    updatedAt: minutesAgo(5),
  });

  it('a session known only from reconcile: blocked, failed and unread review_ready are notes', () => {
    const base = { reportedAt: null, state: 'unknown' as const, stateText: '' };
    for (const r of [rec('blocked'), rec('failed'), rec('review_ready', true)]) {
      const [item] = attention({ sessions: [session({ ...base, reconcile: r })] });
      expect(item).toMatchObject({
        kind: 'session_reconcile',
        level: 'note',
        text: 'нужно разблокировать телефон',
        since: minutesAgo(5),
      });
    }
  });

  it('read review_ready, working and completed are not items', () => {
    const base = { reportedAt: null, state: 'unknown' as const, stateText: '' };
    for (const r of [rec('review_ready', false), rec('working'), rec('completed', true)]) {
      expect(kinds({ sessions: [session({ ...base, reconcile: r })] })).toEqual([]);
    }
  });

  it('falls back to the title, then to «ждёт ответа», when there is no summary', () => {
    const base = { reportedAt: null, state: 'unknown' as const, stateText: '' };
    const r = { ...rec('blocked'), summary: null };
    expect(attention({ sessions: [session({ ...base, title: 'PSPlatina', reconcile: r })] })[0]?.text).toBe('PSPlatina');
    expect(attention({ sessions: [session({ ...base, title: null, reconcile: r })] })[0]?.text).toBe('ждёт ответа');
  });

  it('a hook-reporting session: unread review_ready never adds a note on top of its status', () => {
    const s = session({ state: 'done', reportedAt: minutesAgo(30), reconcile: rec('review_ready', true) });
    expect(kinds({ sessions: [s] })).toEqual([]);
  });

  it('a hook-reporting session blocked well after its last report → a note', () => {
    const s = session({ state: 'done', reportedAt: minutesAgo(30), reconcile: rec('blocked') });
    expect(kinds({ sessions: [s] })).toEqual(['session_reconcile']);
  });

  it('a blocked bucket older than, or within 2 minutes of, the hook report is ignored', () => {
    const older = session({ state: 'done', reportedAt: minutesAgo(1), reconcile: rec('blocked') });
    const close = session({ state: 'done', reportedAt: minutesAgo(6), reconcile: rec('blocked') });
    expect(kinds({ sessions: [older, close] })).toEqual([]);
  });

  it('needs_owner from the hook wins over a reconcile note for the same session', () => {
    const s = session({ state: 'needs_owner', reportedAt: minutesAgo(30), reconcile: rec('blocked') });
    expect(kinds({ sessions: [s] })).toEqual(['session_needs_owner']);
  });

  it('an archived blocked session still surfaces', () => {
    const s = session({ archived: true, reportedAt: null, state: 'unknown', stateText: '', reconcile: rec('blocked') });
    expect(kinds({ sessions: [s] })).toEqual(['session_reconcile']);
  });

  it('an archived session that is merely unread does not', () => {
    const s = session({ archived: true, reportedAt: null, state: 'unknown', stateText: '', reconcile: rec('review_ready', true) });
    expect(kinds({ sessions: [s] })).toEqual([]);
  });
});

describe('pull request items', () => {
  it('green, mergeable, non-draft open PR with nobody working → «готов к мержу»', () => {
    const p = pr({ number: 3, title: 'InfoTip', updatedAt: minutesAgo(40) });
    expect(attention({ prs: [p] })).toEqual([
      {
        key: 'pr:o/r#3',
        kind: 'pr_ready',
        level: 'request',
        projectId: 'p1',
        text: 'PR #3 InfoTip — готов к мержу',
        sessionId: null,
        pr: { repo: 'o/r', number: 3 },
        repo: 'o/r',
        since: minutesAgo(40),
      },
    ]);
  });

  it('never ready with no checks, pending checks, unknown or false mergeable', () => {
    expect(kinds({ prs: [pr({ checks: 'none' })] })).toEqual([]);
    expect(kinds({ prs: [pr({ checks: 'pending' })] })).toEqual([]);
    expect(kinds({ prs: [pr({ mergeable: null })] })).toEqual([]);
    expect(kinds({ prs: [pr({ mergeable: false })] })).toEqual([]);
  });

  it('failed checks with nobody working → «CI упал, никто не чинит», whatever mergeable says', () => {
    const [item] = attention({ prs: [pr({ number: 7, title: 'Fix', checks: 'failure', mergeable: null })] });
    expect(item).toMatchObject({ kind: 'ci_failed', level: 'request', text: 'PR #7 Fix — CI упал, никто не чинит' });
  });

  it('draft, closed and merged PRs produce nothing', () => {
    expect(kinds({ prs: [pr({ draft: true }), pr({ state: 'closed' }), pr({ state: 'merged', checks: 'failure' })] })).toEqual([]);
  });

  it('a working session on the PR branch hides both PR items', () => {
    const s = session({ state: 'working', reportedAt: minutesAgo(10) });
    expect(kinds({ sessions: [s], prs: [pr()] })).toEqual([]);
    expect(kinds({ sessions: [s], prs: [pr({ checks: 'failure' })] })).toEqual([]);
  });

  it('a working session linked by sessionId on another branch hides them too', () => {
    const s = session({ state: 'working', branch: 'claude/elsewhere' });
    expect(kinds({ sessions: [s], prs: [pr({ sessionId: s.id })] })).toEqual([]);
  });

  it('a working session on another repo or branch does not hide them', () => {
    const s = session({ state: 'working', repo: 'o/other' });
    expect(kinds({ sessions: [s], prs: [pr()] })).toEqual(['pr_ready']);
  });

  it('once working expires the PR speaks for itself again, next to the «сессия молчит» note', () => {
    const s = session({ state: 'working', stateText: 'жду CI', reportedAt: minutesAgo(200) });
    expect(kinds({ sessions: [s], prs: [pr()] })).toEqual(['session_silent', 'pr_ready']);
    expect(kinds({ sessions: [s], prs: [pr({ checks: 'failure' })] })).toEqual(['session_silent', 'ci_failed']);
  });

  it('a note about the session never hides a request about its PR', () => {
    const noStatus = session({ state: 'unknown', stateText: 'хвост' });
    expect(kinds({ sessions: [noStatus], prs: [pr()] })).toEqual(['session_unknown', 'pr_ready']);
    const blocked = session({
      state: 'done',
      reportedAt: minutesAgo(30),
      reconcile: { bucket: 'blocked', unread: false, summary: 'ждёт разрешения', updatedAt: minutesAgo(5) },
    });
    expect(kinds({ sessions: [blocked], prs: [pr({ checks: 'failure' })] })).toEqual(['session_reconcile', 'ci_failed']);
  });

  it('one item per cause: a needs_owner session suppresses the items of its PR', () => {
    const s = session({ state: 'needs_owner', stateText: 'смержить PR #3' });
    expect(kinds({ sessions: [s], prs: [pr({ number: 3 })] })).toEqual(['session_needs_owner']);
  });

  it('a done session does not suppress its green PR', () => {
    expect(kinds({ sessions: [session({ state: 'done' })], prs: [pr()] })).toEqual(['pr_ready']);
  });

  it('takes the project from the repository', () => {
    const p = pr({ repo: 'o/dalada' });
    const items = attention({ repos: [repo(), repo({ fullName: 'o/dalada', projectId: 'p2' })], prs: [p] });
    expect(items[0]?.projectId).toBe('p2');
  });

  it('a PR in an unknown repository has no project', () => {
    expect(attention({ prs: [pr({ repo: 'o/unknown' })] })[0]?.projectId).toBeNull();
  });
});

describe('main_red', () => {
  const main = (over: Parameters<typeof run>[0]) => run({ branch: 'main', ...over });

  it('latest completed push run of a workflow on the default branch failed → request', () => {
    const r = main({ workflow: 'CI', conclusion: 'failure', completedAt: minutesAgo(12) });
    expect(attention({ runs: [r] })).toEqual([
      {
        key: 'main:o/r:CI',
        kind: 'main_red',
        level: 'request',
        projectId: 'p1',
        text: 'main красный: CI',
        sessionId: null,
        pr: null,
        repo: 'o/r',
        since: minutesAgo(12),
      },
    ]);
  });

  it('timed_out counts as red', () => {
    expect(kinds({ runs: [main({ conclusion: 'timed_out' })] })).toEqual(['main_red']);
  });

  it('a later success clears it; an earlier success does not', () => {
    const fail = main({ conclusion: 'failure', completedAt: minutesAgo(30) });
    expect(kinds({ runs: [fail, main({ conclusion: 'success', completedAt: minutesAgo(5) })] })).toEqual([]);
    expect(kinds({ runs: [fail, main({ conclusion: 'success', completedAt: minutesAgo(90) })] })).toEqual(['main_red']);
  });

  it('cancelled and skipped runs do not decide the colour', () => {
    const fail = main({ conclusion: 'failure', completedAt: minutesAgo(30) });
    expect(kinds({ runs: [fail, main({ conclusion: 'cancelled', completedAt: minutesAgo(5) })] })).toEqual(['main_red']);
    expect(kinds({ runs: [main({ conclusion: 'cancelled' })] })).toEqual([]);
  });

  it('each workflow is judged on its own', () => {
    const items = attention({
      runs: [main({ workflow: 'CI', conclusion: 'failure' }), main({ workflow: 'Pages', conclusion: 'success' })],
    });
    expect(items.map((i) => i.key)).toEqual(['main:o/r:CI']);
  });

  it('ignores other branches, unfinished runs, and manually dispatched or scheduled runs', () => {
    expect(kinds({ runs: [run({ branch: 'claude/x', conclusion: 'failure' })] })).toEqual([]);
    expect(kinds({ runs: [main({ status: 'in_progress', conclusion: null, completedAt: null })] })).toEqual([]);
    expect(kinds({ runs: [main({ event: 'workflow_dispatch', conclusion: 'failure' })] })).toEqual([]);
    expect(kinds({ runs: [main({ event: 'schedule', conclusion: 'failure' })] })).toEqual([]);
  });

  it('uses the default branch of the repository, not the literal name main', () => {
    const r = run({ repo: 'o/old', branch: 'master', conclusion: 'failure' });
    expect(kinds({ repos: [repo({ fullName: 'o/old', defaultBranch: 'master' })], runs: [r] })).toEqual(['main_red']);
  });
});

it('keys are unique across a busy snapshot', () => {
  const s1 = session({ state: 'needs_owner' });
  const s2 = session({ state: 'unknown', branch: 'claude/y' });
  const items = attention({
    sessions: [s1, s2],
    prs: [pr({ branch: 'claude/x' }), pr({ branch: 'claude/z' }), pr({ branch: 'claude/w', checks: 'failure' })],
    runs: [run({ branch: 'main', conclusion: 'failure' })],
  });
  const keys = items.map((i) => i.key);
  expect(new Set(keys).size).toBe(keys.length);
  expect(items.map((i) => i.kind).sort()).toEqual(
    ['ci_failed', 'main_red', 'pr_ready', 'session_needs_owner', 'session_unknown'].sort(),
  );
});
