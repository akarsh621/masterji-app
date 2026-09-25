import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { api, createSale, saleBody, drawer, users, categories, bill, billItems, queryOne } from './helpers.mjs';

const { admin, s1 } = users();
const [kurti] = categories();
const daysAgo = n => new Date(Date.now() + 5.5 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);

// ── Void ───────────────────────────────────────────────────────────

test('voiding a backdated cash bill leaves the drawer alone (it never added cash)', async () => {
  const before = drawer();
  const b = await createSale(admin, [[kurti.id, 1000, 1000]], [{ mode: 'cash', amount: 1000 }], { bill_date: daysAgo(3) });
  assert.equal(drawer(), before, 'backdated sale should not touch the drawer');
  const res = await api(admin, 'DELETE', `/api/bills/${b.bill_id}`);
  assert.equal(res.status, 200);
  assert.equal(drawer(), before, 'voiding it should not take cash out either');
});

test('a sale with an active return cannot be voided until the return is voided', async () => {
  const b = await createSale(s1, [[kurti.id, 1000, 1000]], [{ mode: 'cash', amount: 1000 }]);
  const ret = await api(s1, 'POST', `/api/bills/${b.bill_id}/return`, {
    items: [{ bill_item_id: billItems(b.bill_id)[0].id, quantity: 1 }], refund_mode: 'cash',
  });
  assert.equal(ret.status, 201);
  const before = drawer();
  const blocked = await api(admin, 'DELETE', `/api/bills/${b.bill_id}`);
  assert.equal(blocked.status, 409);
  assert.equal(drawer(), before);
  assert.equal(bill(b.bill_id).deleted_at, null);

  assert.equal((await api(admin, 'DELETE', `/api/bills/${ret.body.bill_id}`)).status, 200);
  assert.equal((await api(admin, 'DELETE', `/api/bills/${b.bill_id}`)).status, 200);
  assert.equal(drawer(), before, 'return void (+1000) and sale void (-1000) cancel out');
});

test('voiding a bill cancels its pending print job', async () => {
  const b = await createSale(s1, [[kurti.id, 500, 500]], [{ mode: 'upi', amount: 500 }]);
  const q = await api(s1, 'POST', '/api/print-queue', { bill_id: b.bill_id });
  assert.ok(q.status === 200 || q.status === 201, JSON.stringify(q.body));
  await api(s1, 'DELETE', `/api/bills/${b.bill_id}`);
  const job = queryOne('SELECT status FROM print_queue WHERE bill_id = ? ORDER BY id DESC', b.bill_id);
  assert.equal(job.status, 'failed');
  const pending = await api(null, 'GET', '/api/print-queue?status=pending', undefined, { 'x-print-agent-token': process.env.PRINT_AGENT_TOKEN });
  assert.ok(!pending.body.some(j => j.bill_id === b.bill_id), 'voided bill must not reach the printer');
});

// ── Payments and discounts ─────────────────────────────────────────

test('an explicit discount_amount of 0 is respected (small bills are not rejected)', async () => {
  const res = await api(s1, 'POST', '/api/bills', saleBody([[kurti.id, 40, 40]], [{ mode: 'upi', amount: 40 }], { discount_percent: 1, discount_amount: 0 }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.total, 40);
});

test('stored discount_percent always matches the stored discount_amount', async () => {
  const b = await createSale(s1, [[kurti.id, 1995, 1995]], [{ mode: 'upi', amount: 1790 }], { discount_percent: 10, discount_amount: 205 });
  const row = bill(b.bill_id);
  assert.equal(row.discount_amount, 205);
  assert.equal(row.discount_percent, Math.round(205 / 1995 * 10000) / 100);
});

// ── Duplicate protection (idempotency) ─────────────────────────────

test('retrying a bill with the same client_request_id creates exactly one bill', async () => {
  const id = randomUUID();
  const body = saleBody([[kurti.id, 600, 600]], [{ mode: 'cash', amount: 600 }], { client_request_id: id });
  const before = drawer();
  const first = await api(s1, 'POST', '/api/bills', body);
  const second = await api(s1, 'POST', '/api/bills', body);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.bill_id, first.body.bill_id);
  assert.equal(queryOne('SELECT COUNT(*) AS n FROM bills WHERE client_request_id = ?', id).n, 1);
  assert.equal(drawer(), before + 600, 'cash counted once');
});

test('retrying a cash-out with the same client_request_id records it once', async () => {
  const id = randomUUID();
  const before = drawer();
  const body = { amount: 50, reason: 'expense', note: 'chai', client_request_id: id };
  assert.equal((await api(admin, 'POST', '/api/cash-out', body)).status, 201);
  assert.equal((await api(admin, 'POST', '/api/cash-out', body)).status, 200);
  assert.equal(drawer(), before - 50);
});

test('retrying a return with the same client_request_id refunds once', async () => {
  const b = await createSale(s1, [[kurti.id, 700, 700]], [{ mode: 'cash', amount: 700 }]);
  const body = { items: [{ bill_item_id: billItems(b.bill_id)[0].id, quantity: 1 }], refund_mode: 'cash', client_request_id: randomUUID() };
  const before = drawer();
  const first = await api(s1, 'POST', `/api/bills/${b.bill_id}/return`, body);
  const second = await api(s1, 'POST', `/api/bills/${b.bill_id}/return`, body);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.bill_id, first.body.bill_id);
  assert.equal(drawer(), before - 700);
});

// ── Drawer arithmetic ──────────────────────────────────────────────

test('the drawer stays at 2 decimal places through paise amounts', async () => {
  for (const amt of [100.1, 100.2, 0.7]) {
    await createSale(s1, [[kurti.id, amt, amt]], [{ mode: 'cash', amount: amt }]);
  }
  const d = drawer();
  assert.equal(d, Math.round(d * 100) / 100);
});
