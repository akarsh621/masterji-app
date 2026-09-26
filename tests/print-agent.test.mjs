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

test('a queued return tells the agent it is a return, and which bill it returned', async () => {
  const { api, createSale, categories, billItems } = await import('./helpers.mjs');
  const [kurti] = categories();
  const sale = await createSale(s1, [[kurti.id, 1000, 900]], [{ mode: 'cash', amount: 900 }]);
  const ret = await api(s1, 'POST', `/api/bills/${sale.bill_id}/return`, {
    items: [{ bill_item_id: billItems(sale.bill_id)[0].id, quantity: 1 }], refund_mode: 'cash',
  });
  assert.equal(ret.status, 201, JSON.stringify(ret.body));
  const returnId = ret.body.bill_id;
  assert.equal((await api(s1, 'POST', '/api/print-queue', { bill_id: returnId })).status, 201);
  const jobs = await (await fetch(`${BASE_URL}/api/print-queue`, { headers: agent })).json();
  const job = jobs.find(j => j.bill_id === returnId);
  assert.equal(job.type, 'return');
  assert.equal(job.original_bill_number, sale.bill_number);
});
