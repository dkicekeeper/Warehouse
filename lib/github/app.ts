import { createSign } from 'node:crypto';
import { registerRepo, saveJob, savePr, saveRun } from '@/lib/ingest/github';
import type { Store } from '@/lib/store/store';

const API = 'https://api.github.com';
const SESSION_TRAILER = /Claude-Session:\s*https:\/\/claude\.ai\/code\/(session_[A-Za-z0-9]+)/;
const DAY = 24 * 3600_000;

export interface GithubApp {
  /** Reads the truth from GitHub: open PRs and the last day of runs in every installed repository. */
  resync(store: Store, now: Date): Promise<void>;
  /** Fetches one PR in full: mergeable, and the session named in its commit trailers. */
  enrichPr(store: Store, repo: string, number: number): Promise<void>;
  cancelRun(repo: string, runId: number): Promise<void>;
  /** How many webhook deliveries GitHub could not hand over since `since`. */
  failedDeliveriesSince(since: Date): Promise<number>;
}

interface RepoInfo {
  full_name: string;
  name?: string;
  default_branch?: string;
}

const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url');

export function createGithubApp(config: {
  appId: string;
  privateKey: string;
  fetchImpl?: typeof fetch;
}): GithubApp {
  const fetchImpl = config.fetchImpl ?? fetch;
  let installations: { token: string; expiresAt: number; repos: RepoInfo[] }[] | null = null;

  function jwt(): string {
    const iat = Math.floor(Date.now() / 1000) - 60;
    const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64(JSON.stringify({ iat, exp: iat + 600, iss: config.appId }));
    const signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(config.privateKey);
    return `${head}.${claims}.${b64(signature)}`;
  }

  async function call<T>(method: string, path: string, token: string): Promise<T> {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'warehouse-dispatch',
      },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      let message = detail;
      try {
        message = (JSON.parse(detail) as { message?: string }).message ?? detail;
      } catch {
        /* not JSON */
      }
      throw new Error(`GitHub ${method} ${path.split('?')[0]} → ${res.status} ${message}`.trim());
    }
    if (res.status === 204 || res.status === 202) return undefined as T;
    return (await res.json()) as T;
  }

  /** Installations with a live token and their repositories. Tokens last an hour; reuse them. */
  async function load(): Promise<NonNullable<typeof installations>> {
    if (installations && installations.every((i) => i.expiresAt - Date.now() > 5 * 60_000)) return installations;
    const appToken = jwt();
    const list = await call<{ id: number }[]>('GET', '/app/installations?per_page=100', appToken);
    const out: NonNullable<typeof installations> = [];
    for (const inst of list) {
      const t = await call<{ token: string; expires_at: string }>('POST', `/app/installations/${inst.id}/access_tokens`, appToken);
      const r = await call<{ repositories: RepoInfo[] }>('GET', '/installation/repositories?per_page=100', t.token);
      out.push({ token: t.token, expiresAt: new Date(t.expires_at).getTime(), repos: r.repositories });
    }
    installations = out;
    return out;
  }

  async function tokenFor(repo: string): Promise<string> {
    const inst = (await load()).find((i) => i.repos.some((r) => r.full_name === repo));
    if (!inst) throw new Error(`Приложение GitHub не установлено на ${repo}`);
    return inst.token;
  }

  async function syncPr(store: Store, repo: string, number: number, token: string): Promise<void> {
    const pr = await savePr(store, repo, await call<unknown>('GET', `/repos/${repo}/pulls/${number}`, token));
    if (!pr || pr.sessionId || pr.state !== 'open') return;
    const commits = await call<{ commit: { message: string } }[]>('GET', `/repos/${repo}/pulls/${number}/commits?per_page=100`, token);
    for (const c of commits.slice().reverse()) {
      const m = SESSION_TRAILER.exec(c.commit.message);
      if (m?.[1]) {
        await store.upsertPr({ ...pr, sessionId: m[1] });
        return;
      }
    }
  }

  async function syncRunJobs(store: Store, repo: string, runId: number, token: string, now: Date): Promise<void> {
    const jobs = await call<{ jobs: unknown[] }>('GET', `/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`, token);
    for (const j of jobs.jobs) await saveJob(store, repo, j, now);
  }

  async function syncRepo(store: Store, info: RepoInfo, token: string, now: Date): Promise<void> {
    const repo = info.full_name;
    await registerRepo(store, info);
    const before = await store.loadSnapshot(now);

    const open = await call<{ number: number }[]>('GET', `/repos/${repo}/pulls?state=open&per_page=100`, token);
    const openNumbers = new Set(open.map((p) => p.number));
    const vanished = before.prs.filter((p) => p.repo === repo && !openNumbers.has(p.number)).map((p) => p.number);
    for (const number of [...openNumbers, ...vanished]) await syncPr(store, repo, number, token);

    const since = new Date(now.getTime() - DAY).toISOString();
    const listed = await call<{ workflow_runs: { id: number }[] }>(
      'GET',
      `/repos/${repo}/actions/runs?per_page=100&created=${encodeURIComponent(`>=${since}`)}`,
      token,
    );
    const seen = new Set<number>();
    for (const raw of listed.workflow_runs) {
      seen.add(raw.id);
      const run = await saveRun(store, repo, raw);
      if (run && run.status !== 'completed') await syncRunJobs(store, repo, run.id, token, now);
    }
    // Runs and jobs the service still believes are going, but GitHub did not list: ask about each.
    const liveRuns = new Set([
      ...before.runs.filter((r) => r.repo === repo && r.status !== 'completed').map((r) => r.id),
      ...before.jobs.filter((j) => j.repo === repo).map((j) => j.runId),
    ]);
    for (const id of liveRuns) {
      if (!seen.has(id)) await saveRun(store, repo, await call<unknown>('GET', `/repos/${repo}/actions/runs/${id}`, token));
      const now2 = await store.getRun(id);
      if (!seen.has(id) || now2?.status === 'completed') await syncRunJobs(store, repo, id, token, now);
    }
  }

  return {
    async resync(store, now) {
      const failures: string[] = [];
      for (const inst of await load()) {
        for (const info of inst.repos) {
          try {
            await syncRepo(store, info, inst.token, now);
          } catch (err) {
            failures.push(`${info.full_name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
      if (failures.length > 0) throw new Error(failures.join('; '));
    },

    async enrichPr(store, repo, number) {
      await syncPr(store, repo, number, await tokenFor(repo));
    },

    async cancelRun(repo, runId) {
      await call<void>('POST', `/repos/${repo}/actions/runs/${runId}/cancel`, await tokenFor(repo));
    },

    async failedDeliveriesSince(since) {
      const list = await call<{ delivered_at: string; status_code: number }[]>('GET', '/app/hook/deliveries?per_page=100', jwt());
      return list.filter(
        (d) => new Date(d.delivered_at).getTime() >= since.getTime() && (d.status_code < 200 || d.status_code >= 300),
      ).length;
    },
  };
}

/** The app as configured in the environment, or null while it is not set up yet. */
export function githubApp(): GithubApp | null {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) return null;
  // Environment variables often carry the PEM with literal "\n".
  return createGithubApp({ appId, privateKey: privateKey.replace(/\\n/g, '\n') });
}
