import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BASE_URL, token, users, queryOne } from './helpers.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { admin, s1 } = users();

async function download(headers) {
  const res = await fetch(`${BASE_URL}/api/backup`, { headers });
  return { res, buf: Buffer.from(await res.arrayBuffer()) };
}

test('admin can download a complete, openable backup', async () => {
  const { res, buf } = await download({ Authorization: `Bearer ${token(admin)}` });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /masterji-.*\.db/);

  const file = path.join(os.tmpdir(), `backup-test-${Date.now()}.db`);
  fs.writeFileSync(file, buf);
  const copy = new Database(file, { readonly: true });
  try {
    assert.equal(copy.pragma('journal_mode', { simple: true }), 'delete', 'backup should be a single self-contained file');
    const live = queryOne('SELECT COUNT(*) AS n FROM users').n;
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM users').get().n, live);
    assert.ok(copy.prepare('SELECT COUNT(*) AS n FROM bills').get().n >= 0);
  } finally {
    copy.close();
    fs.rmSync(file, { force: true });
  }
});

test('the print agent token can download a backup', async () => {
  const { res } = await download({ 'x-print-agent-token': process.env.PRINT_AGENT_TOKEN });
  assert.equal(res.status, 200);
});

test('salesmen, wrong agent tokens and anonymous users cannot', async () => {
  assert.equal((await download({ Authorization: `Bearer ${token(s1)}` })).res.status, 403);
  assert.equal((await download({ 'x-print-agent-token': 'wrong' })).res.status, 401);
  assert.equal((await download({})).res.status, 401);
});
