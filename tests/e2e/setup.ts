import { spawn, type ChildProcess } from 'node:child_process';

export const PORT = 3987;
export const BASE = `http://127.0.0.1:${PORT}`;

let server: ChildProcess | undefined;

/** Starts the built app. Run `pnpm build` first; `pnpm test:e2e` does both. */
export async function setup() {
  server = spawn('node_modules/.bin/next', ['start', '-p', String(PORT), '-H', '127.0.0.1'], {
    env: {
      ...process.env,
      // A real-looking secret, so a forged cookie is refused by its signature, not by a missing setting.
      SESSION_SECRET: 'e2e-'.padEnd(64, 'x'),
      OWNER_GITHUB_ID: '1',
      // Deliberately no DATABASE_URL and no secrets: nothing here may need them to refuse a stranger.
      DATABASE_URL: '',
    },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/login`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('next start did not come up');
}

export async function teardown() {
  server?.kill();
}
