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
