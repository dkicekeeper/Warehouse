import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionReport } from '@/lib/ingest/sessions';

const SCRIPT = resolve('hooks/warehouse-report.py');

interface Received {
  path: string;
  auth: string | undefined;
  body: Record<string, unknown>;
}

let server: Server;
let received: Received[];
let respond: (res: import('node:http').ServerResponse) => void;
let url: string;

beforeEach(async () => {
  received = [];
  respond = (res) => res.writeHead(204).end();
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({ path: req.url ?? '', auth: req.headers.authorization, body: JSON.parse(raw || '{}') });
      respond(res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((r) => {
  server.closeAllConnections();
  server.close(() => r());
}));

function run(
  stdin: string,
  env: Record<string, string | undefined> = {},
  cwd = process.cwd(),
): Promise<{ code: number | null; stdout: string; stderr: string; ms: number }> {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn('python3', [SCRIPT], {
      cwd,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NO_PROXY: '127.0.0.1', WAREHOUSE_URL: url, ...env } as unknown as NodeJS.ProcessEnv,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => done({ code, stdout, stderr, ms: Date.now() - started }));
    child.stdin.end(stdin);
  });
}

/**
 * A repository of the test's own, so nothing depends on how this one happens to be checked out
 * (CI checks a pull request out with a detached HEAD).
 */
function repoOn(branch: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'wh-repo-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', 'https://github.com/dkicekeeper/Warehouse.git');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  if (branch) git('checkout', '-q', '-b', branch);
  else git('checkout', '-q', '--detach');
  return dir;
}

const REPO_DIR = repoOn('claude/feature-x');

const stop = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    session_id: '20e570d0-daba-559b-8477-09337c2e3975',
    transcript_path: '/nonexistent.jsonl',
    cwd: REPO_DIR,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: 'Собрал и проверил.\n\nСтатус: ждёт владельца — смержить PR #3',
    ...over,
  });

const quiet = (r: { code: number | null; stdout: string; stderr: string }) => {
  expect(r.code).toBe(0);
  expect(r.stdout).toBe('');
  expect(r.stderr).toBe('');
};

describe('warehouse-report hook', () => {
  it('posts the session, repository, branch and message tail in the shape the server accepts', async () => {
    const r = await run(stop(), { WAREHOUSE_REPORT_TOKEN: 'tok_local' });
    quiet(r);
    expect(received).toHaveLength(1);
    const [req] = received;
    expect(req?.path).toBe('/api/report/session');
    expect(req?.auth).toBe('Bearer tok_local');
    expect(SessionReport.safeParse(req?.body).success).toBe(true);
    expect(req?.body).toMatchObject({
      session_id: '20e570d0-daba-559b-8477-09337c2e3975',
      repo: 'dkicekeeper/Warehouse',
      branch: 'claude/feature-x',
      message_tail: 'Собрал и проверил.\n\nСтатус: ждёт владельца — смержить PR #3',
    });
  });

  it('in a cloud session reports the id the session URL uses', async () => {
    await run(stop(), { CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_016AMHdAyYdV4yz7XyXihgwn' });
    expect(received[0]?.body.session_id).toBe('session_016AMHdAyYdV4yz7XyXihgwn');
  });

  it('without a token of its own sends a placeholder for the environment proxy to replace', async () => {
    await run(stop());
    expect(received[0]?.auth).toBe('Bearer proxy-injected');
  });

  it('when the owner sends a message, reports the session as working and never the owner’s words', async () => {
    const event = JSON.stringify({
      session_id: '20e570d0-daba-559b-8477-09337c2e3975',
      cwd: REPO_DIR,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'мой пароль hunter2, смержи',
    });
    const r = await run(event);
    quiet(r);
    expect(received).toHaveLength(1);
    expect(received[0]?.body.message_tail).toBe('Статус: работаю — получено новое сообщение');
    expect(JSON.stringify(received[0]?.body)).not.toContain('hunter2');
    expect(SessionReport.safeParse(received[0]?.body).success).toBe(true);
  });

  it('ignores hook events it was not written for', async () => {
    quiet(await run(JSON.stringify({ session_id: 'x', hook_event_name: 'PreToolUse', tool_name: 'Bash' })));
    expect(received).toEqual([]);
  });

  it('sends only the last 2000 characters of a long message', async () => {
    await run(stop({ last_assistant_message: 'а'.repeat(5000) + '\nСтатус: готово — всё' }));
    const tail = String(received[0]?.body.message_tail);
    expect(tail.length).toBe(2000);
    expect(tail.endsWith('Статус: готово — всё')).toBe(true);
  });

  it('falls back to the transcript when the event carries no message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wh-hook-'));
    const transcript = join(dir, 't.jsonl');
    writeFileSync(
      transcript,
      [
        { type: 'user', message: { content: 'привет' } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'старое сообщение' }] } },
        { type: 'assistant', message: { content: [{ type: 'thinking', thinking: '…' }] } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Статус: работаю — жду CI' }] } },
        { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] } },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n') + '\nnot json\n',
    );
    await run(stop({ last_assistant_message: undefined, transcript_path: transcript }));
    expect(received[0]?.body.message_tail).toBe('Статус: работаю — жду CI');
  });

  it('with neither a message nor a readable transcript still reports, with an empty tail', async () => {
    await run(stop({ last_assistant_message: undefined }));
    expect(received[0]?.body.message_tail).toBe('');
  });

  it('on a detached HEAD reports the repository with no branch', async () => {
    const dir = repoOn(null);
    quiet(await run(stop({ cwd: dir }), {}, dir));
    expect(received[0]?.body).toMatchObject({ repo: 'dkicekeeper/Warehouse', branch: null });
    expect(SessionReport.safeParse(received[0]?.body).success).toBe(true);
  });

  it('reads the repository from an ssh remote as well', async () => {
    const dir = repoOn('claude/ssh');
    execFileSync('git', ['remote', 'set-url', 'origin', 'git@github.com:dkicekeeper/Tenra.git'], { cwd: dir });
    await run(stop({ cwd: dir }), {}, dir);
    expect(received[0]?.body.repo).toBe('dkicekeeper/Tenra');
  });

  it('outside a git repository sends null for repository and branch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wh-nogit-'));
    quiet(await run(stop({ cwd: dir }), {}, dir));
    expect(received[0]?.body).toMatchObject({ repo: null, branch: null });
    expect(SessionReport.safeParse(received[0]?.body).success).toBe(true);
  });

  it.each([
    ['empty input', ''],
    ['input that is not JSON', 'oops'],
    ['JSON that is not an object', '[1,2]'],
    ['a stop already continued by a hook', stop({ stop_hook_active: true })],
    ['an event without a session id anywhere', stop({ session_id: undefined })],
  ])('%s: exits 0, says nothing, sends nothing', async (_n, input) => {
    quiet(await run(input));
    expect(received).toEqual([]);
  });

  it('with no service address configured it sends nothing anywhere', async () => {
    quiet(await run(stop(), { WAREHOUSE_URL: '' }));
    expect(received).toEqual([]);
  });

  it('refuses to send over plain http to anything but this machine', async () => {
    quiet(await run(stop(), { WAREHOUSE_URL: 'http://example.com' }));
    quiet(await run(stop(), { WAREHOUSE_URL: 'ftp://127.0.0.1' }));
    expect(received).toEqual([]);
  });

  it('server refuses the connection: exits 0, says nothing, quickly', async () => {
    const r = await run(stop(), { WAREHOUSE_URL: 'http://127.0.0.1:9' });
    quiet(r);
    expect(r.ms).toBeLessThan(5000);
  });

  it('server hangs: gives up within 6 seconds, exits 0, says nothing', async () => {
    respond = () => {
      /* never answer */
    };
    const r = await run(stop());
    quiet(r);
    expect(r.ms).toBeLessThan(6000);
  }, 15_000);

  it.each([401, 403, 500])('server answers %i: exits 0, says nothing', async (status) => {
    respond = (res) => res.writeHead(status).end('<html>blocked</html>');
    quiet(await run(stop()));
  });

  it('never prints the token, even when asked to be verbose by a hostile environment', async () => {
    const r = await run(stop(), { WAREHOUSE_REPORT_TOKEN: 'tok_secret', WAREHOUSE_URL: 'http://127.0.0.1:9', CURL_VERBOSE: '1' });
    expect(r.stdout + r.stderr).not.toContain('tok_secret');
  });
});
