import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { api, createSale, users, categories, billItems, drawer, bill } from './helpers.mjs';
import { quarterLockDate, isQuarterLocked, quarterLabel } from '../src/lib/date-utils.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { admin, s1 } = users();
const [kurti] = categories();

test('a quarter locks on the 11th of the month after it ends', () => {
  assert.equal(quarterLockDate('2026-04-01'), '2026-07-11');
  assert.equal(quarterLockDate('2026-06-30'), '2026-07-11');
  assert.equal(quarterLockDate('2026-09-15'), '2026-10-11');
  assert.equal(quarterLockDate('2026-12-31'), '2027-01-11');
  assert.equal(quarterLockDate('2027-02-10'), '2027-04-11');
  assert.equal(isQuarterLocked('2026-06-30', '2026-07-10'), false, 'still open on the 10th');
  assert.equal(isQuarterLocked('2026-06-30', '2026-07-11'), true, 'locked from the 11th');
  assert.equal(isQuarterLocked('2026-07-01', '2026-07-11'), false, 'current quarter never locked');
  assert.equal(quarterLabel('2026-05-05'), 'Apr–Jun 2026');
  assert.equal(quarterLabel('2027-01-05'), 'Jan–Mar 2027');
});

// A bill dated in a long-closed quarter (as if made then).
async function oldBill() {
  const b = await createSale(s1, [[kurti.id, 1000, 1000]], [{ mode: 'cash', amount: 1000 }]);
  const conn = new Database(path.join(process.env.DATA_DIR, 'masterji_dev.db'));
  conn.prepare("UPDATE bills SET created_at = '2025-06-15 12:00:00' WHERE id = ?").run(b.bill_id);
  conn.close();
  return b;
}

test('bills in a closed quarter cannot be cancelled or edited, even by admin', async () => {
  const b = await oldBill();
  const before = drawer();
  const cancel = await api(admin, 'DELETE', `/api/bills/${b.bill_id}`);
  assert.equal(cancel.status, 403);
  assert.match(cancel.body.error, /Apr–Jun 2025/);
  const edit = await api(admin, 'POST', '/api/bills', {
    items: [{ category_id: kurti.id, mrp: 1000, quantity: 1, amount: 900 }],
    payments: [{ mode: 'cash', amount: 900 }], discount_amount: 0, replaces_bill_id: b.bill_id,
  });
  assert.equal(edit.status, 403);
  assert.equal(bill(b.bill_id).deleted_at, null, 'bill untouched');
  assert.equal(drawer(), before, 'drawer untouched');
});

test('a closed-quarter bill can still be returned; the return counts today', async () => {
  const b = await oldBill();
  const res = await api(admin, 'POST', `/api/bills/${b.bill_id}/return`, {
    items: [{ bill_item_id: billItems(b.bill_id)[0].id, quantity: 1 }], refund_mode: 'upi',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  assert.equal(bill(res.body.bill_id).created_at.slice(0, 10), today);
});

test('quarters follow the financial year, including across the calendar year', async () => {
  const { quarterOf, listQuarters, matchQuarter, cmp08DueDate } = await import('../src/lib/date-utils.js');
  assert.deepEqual(
    { ...quarterOf('2027-02-10') },
    { from: '2027-01-01', to: '2027-03-31', q: 4, fyLabel: 'FY 2026-27', label: 'Jan–Mar 2027' },
  );
  assert.equal(quarterOf('2026-04-01').q, 1);
  assert.equal(cmp08DueDate('2026-11-20'), '2027-01-18');
  const list = listQuarters('2025-11-05', '2026-09-27');
  assert.deepEqual(list.map(q => `${q.fyLabel} ${q.label}`), [
    'FY 2026-27 Jul–Sep 2026', 'FY 2026-27 Apr–Jun 2026', 'FY 2025-26 Jan–Mar 2026', 'FY 2025-26 Oct–Dec 2025',
  ]);
  assert.equal(list[0].current, true);
  assert.equal(list[0].to, '2026-09-27', 'running quarter ends today');
  assert.equal(matchQuarter('2026-07-01', '2026-09-27', '2026-09-27').current, true);
  assert.equal(matchQuarter('2026-04-01', '2026-06-30', '2026-09-27').label, 'Apr–Jun 2026');
  assert.equal(matchQuarter('2026-04-02', '2026-06-30', '2026-09-27'), null, 'a partial range is not a quarter');
});

test('a whole quarter on the Dashboard compares with the whole previous quarter', async () => {
  const jul = await api(admin, 'GET', '/api/dashboard?from=2026-07-01&to=2026-09-30');
  assert.deepEqual(jul.body.period.previous, { from: '2026-04-01', to: '2026-06-30' });
  const jan = await api(admin, 'GET', '/api/dashboard?from=2027-01-01&to=2027-03-31');
  assert.deepEqual(jan.body.period.previous, { from: '2026-10-01', to: '2026-12-31' }, 'across the calendar year');
  const custom = await api(admin, 'GET', '/api/dashboard?from=2026-07-05&to=2026-07-11');
  assert.deepEqual(custom.body.period.previous, { from: '2026-06-28', to: '2026-07-04' }, 'other ranges unchanged');
  assert.match(jul.body.first_bill_date, /^\d{4}-\d{2}-\d{2}$/);
});
