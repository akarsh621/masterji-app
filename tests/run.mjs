// Starts a throwaway Next.js dev server against a temporary database, runs
// every tests/*.test.mjs file against it, then shuts it down.
// Usage: npm test            (all tests)
//        npm test -- returns (only files whose name contains "returns")
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.TEST_PORT || '3100';
const BASE_URL = `http://localhost:${PORT}`;
const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'masterji-test-'));

const env = {
  ...process.env,
  DATA_DIR,
  DB_MODE: 'dev',
  JWT_SECRET: 'test-jwt-secret',
  PRINT_AGENT_TOKEN: 'test-agent-token',
  NEXT_DIST_DIR: '.next-test',
  NEXT_TELEMETRY_DISABLED: '1',
};

const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'dev', '-p', PORT], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

function cleanup() {
  server.kill('SIGTERM');
  rmSync(DATA_DIR, { recursive: true, force: true });
}

async function waitForServer() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/salesmen`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Test server did not start in time.\n' + serverLog);
}

try {
  await waitForServer();
  const filter = process.argv[2];
  const files = readdirSync(path.join(ROOT, 'tests'))
    .filter(f => f.endsWith('.test.mjs') && (!filter || f.includes(filter)))
    .map(f => path.join('tests', f));

  const code = await new Promise(resolve => {
    const runner = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
      cwd: ROOT,
      env: { ...env, BASE_URL },
      stdio: 'inherit',
    });
    runner.on('exit', resolve);
  });
  if (code !== 0 && process.env.SHOW_SERVER_LOG) console.log(serverLog);
  cleanup();
  process.exit(code ?? 1);
} catch (err) {
  console.error(err.message);
  cleanup();
  process.exit(1);
}
