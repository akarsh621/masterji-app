import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BASE_URL, token, users } from './helpers.mjs';

const { s1 } = users();
const agent = { 'x-print-agent-token': process.env.PRINT_AGENT_TOKEN };

async function get(name, headers) {
  const res = await fetch(`${BASE_URL}/api/print-agent/files/${name}`, { headers });
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
}

test('the agent can download agent.py, update.py and start.bat byte-for-byte', async () => {
  for (const name of ['agent.py', 'update.py', 'start.bat']) {
    const res = await get(name, agent);
    assert.equal(res.status, 200, name);
    assert.ok(res.body.equals(fs.readFileSync(`print-agent/${name}`)), `${name} differs from disk`);
  }
});

test('start.bat is served with Windows line endings', async () => {
  const res = await get('start.bat', agent);
  assert.ok(res.body.includes('\r\ngoto loop'));
});

test('files outside the allowlist are never served', async () => {
  for (const name of ['config.ini', 'config.example.ini', '..%2Fpackage.json', '.env.local']) {
    assert.equal((await get(name, agent)).status, 404, name);
  }
});

test('salesmen and anonymous callers cannot download agent files', async () => {
  assert.equal((await get('agent.py', { Authorization: `Bearer ${token(s1)}` })).status, 403);
  assert.equal((await get('agent.py', {})).status, 401);
});
