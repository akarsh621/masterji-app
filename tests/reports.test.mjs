import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { api, createSale, users, categories, billItems, queryOne } from './helpers.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { admin, s1 } = users();
const [kurti, top] = categories();
const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

test('month comparison uses the whole previous month, including its last day', async () => {
  const oct = await api(admin, 'GET', '/api/dashboard?month=2026-10');
  assert.deepEqual(oct.body.period.previous, { from: '2026-09-01', to: '2026-09-30' });
  const mar = await api(admin, 'GET', '/api/dashboard?month=2024-03');
  assert.deepEqual(mar.body.period.current, { from: '2024-03-01', to: '2024-03-31' });
  assert.deepEqual(mar.body.period.previous, { from: '2024-02-01', to: '2024-02-29' }, 'leap year');
});

test('custom range compares against the same number of days just before it', async () => {
  const res = await api(admin, 'GET', '/api/dashboard?from=2026-09-10&to=2026-09-16');
  assert.deepEqual(res.body.period.previous, { from: '2026-09-03', to: '2026-09-09' });
});

test('week compares Monday-Sunday against the whole previous week', async () => {
  const res = await api(admin, 'GET', '/api/dashboard?view=week');
  const { current, previous } = res.body.period;
  assert.equal(new Date(current.from + 'T00:00:00Z').getUTCDay(), 1, 'starts Monday');
  assert.equal(new Date(previous.from + 'T00:00:00Z').getUTCDay(), 1);
  assert.equal(new Date(previous.to + 'T00:00:00Z').getUTCDay(), 0, 'ends Sunday');
});

test('returns are not bills, and the average bill is sales / sale bills', async () => {
  const b = await createSale(s1, [[kurti.id, 1000, 1000], [top.id, 500, 500]], [{ mode: 'upi', amount: 1500 }]);
  await api(s1, 'POST', `/api/bills/${b.bill_id}/return`, {
    items: [{ bill_item_id: billItems(b.bill_id)[1].id, quantity: 1 }], refund_mode: 'upi',
  });
  const t = todayIST();
  const expected = queryOne(`SELECT COUNT(*) AS n, SUM(total) AS gross FROM bills
    WHERE type = 'sale' AND deleted_at IS NULL AND date(created_at) = ?`, t);
  const res = await api(admin, 'GET', '/api/dashboard?view=today');
  assert.equal(res.body.summary.total_bills, expected.n);
  assert.ok(Math.abs(res.body.summary.avg_bill - expected.gross / expected.n) < 0.01);
});

test('Dashboard and Earnings agree on bills and net revenue for the month', async () => {
  const month = todayIST().slice(0, 7);
  const dash = (await api(admin, 'GET', `/api/dashboard?month=${month}`)).body.summary;
  const earn = (await api(admin, 'GET', `/api/earnings?month=${month}`)).body.revenue;
  assert.equal(dash.total_bills, earn.sale_count);
  assert.ok(Math.abs(dash.net_revenue - earn.net_revenue) < 0.01);
});

test('category totals add up to net revenue, even with bill-level discounts', async () => {
  await createSale(s1, [[kurti.id, 999, 999], [top.id, 501, 501]], [{ mode: 'cash', amount: 1300 }], { discount_amount: 200 });
  const res = await api(admin, 'GET', '/api/dashboard?view=today');
  const catSum = res.body.categoryBreakdown.reduce((s, c) => s + c.revenue, 0);
  assert.ok(Math.abs(catSum - res.body.summary.net_revenue) < 1, `${catSum} vs ${res.body.summary.net_revenue}`);
});

test('Hisaab shows cash refunds and cancellations of earlier bills as their own lines', async () => {
  const before = (await api(admin, 'GET', '/api/hisaab')).body;

  // A cash sale and a cash refund today.
  const b = await createSale(s1, [[kurti.id, 800, 800], [top.id, 300, 300]], [{ mode: 'cash', amount: 1100 }]);
  await api(s1, 'POST', `/api/bills/${b.bill_id}/return`, {
    items: [{ bill_item_id: billItems(b.bill_id)[1].id, quantity: 1 }], refund_mode: 'cash',
  });

  // A cash bill from yesterday (made live, not backdated) cancelled today.
  const old = await createSale(s1, [[kurti.id, 700, 700]], [{ mode: 'cash', amount: 700 }]);
  const db = new Database(path.join(process.env.DATA_DIR, 'masterji_dev.db'));
  const yesterday = new Date(Date.now() + 5.5 * 3600e3 - 86400e3).toISOString().slice(0, 10);
  db.prepare("UPDATE bills SET created_at = ? || ' 18:00:00' WHERE id = ?").run(yesterday, old.bill_id);
  db.close();
  await api(admin, 'DELETE', `/api/bills/${old.bill_id}`);

  const after = (await api(admin, 'GET', '/api/hisaab')).body;
  assert.equal(after.cash_in - before.cash_in, 1100, 'only today\'s sale counts as today\'s cash sales');
  assert.equal(after.cash_refunds - before.cash_refunds, 300);
  assert.equal(after.cash_adjustment - before.cash_adjustment, -700);
});
