// Admin's in-place Edit Bill, and the salesman's 1-hour window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { api, createSale, users, categories, billItems, drawer, bill, queryOne } from './helpers.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const DB_FILE = path.join(process.env.DATA_DIR, 'masterji_dev.db');
const { admin, s1, s2 } = users();
const [kurti, top] = categories();

function setCreatedAt(billId, value) {
  const conn = new Database(DB_FILE);
  conn.prepare('UPDATE bills SET created_at = ? WHERE id = ?').run(value, billId);
  conn.close();
}
const istMinutesAgo = (m) => new Date(Date.now() + 5.5 * 3600e3 - m * 60e3).toISOString().slice(0, 19).replace('T', ' ');
const yesterday = () => new Date(Date.now() + 5.5 * 3600e3 - 86400e3).toISOString().slice(0, 10);

const editBody = (lines, payments, extra = {}) => ({
  items: lines.map(([category_id, mrp, amount, quantity = 1]) => ({ category_id, mrp, quantity, amount })),
  payments, discount_amount: 0, ...extra,
});

test('admin edits a bill in place: same number and date, new amounts, drawer moves by the cash difference', async () => {
  const sale = await createSale(s1, [[kurti.id, 1200, 1000]], [{ mode: 'cash', amount: 1000 }]);
  const before = bill(sale.bill_id);
  const drawerBefore = drawer();

  const res = await api(admin, 'PUT', `/api/bills/${sale.bill_id}`,
    editBody([[kurti.id, 1200, 900], [top.id, 500, 400]], [{ mode: 'cash', amount: 700 }, { mode: 'upi', amount: 600 }]));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.bill_number, sale.bill_number);

  const after = bill(sale.bill_id);
  assert.equal(after.bill_number, before.bill_number, 'same bill number');
  assert.equal(after.created_at, before.created_at, 'same date');
  assert.equal(after.deleted_at, null);
  assert.equal(after.total, 1300);
  assert.equal(after.subtotal, 1300);
  assert.equal(after.payment_mode, 'mixed');
  assert.equal(after.salesman_id, s1.id, 'keeps the salesman');
  assert.equal(billItems(sale.bill_id).length, 2);
  assert.equal(drawer(), drawerBefore - 300, 'cash went from 1000 to 700');
  assert.ok(after.edited_at, 'hidden stamp: when');
  assert.equal(after.edited_by, admin.id, 'hidden stamp: who');
  assert.equal(queryOne('SELECT cash_delta FROM bill_edits WHERE bill_id = ? ORDER BY id DESC', sale.bill_id).cash_delta, -300);

  // Saving the same thing again changes nothing.
  const again = await api(admin, 'PUT', `/api/bills/${sale.bill_id}`,
    editBody([[kurti.id, 1200, 900], [top.id, 500, 400]], [{ mode: 'cash', amount: 700 }, { mode: 'upi', amount: 600 }]));
  assert.equal(again.status, 200);
  assert.equal(drawer(), drawerBefore - 300, 'repeat save: drawer unchanged');
});

test('in-place edit uses the same money checks as a new bill', async () => {
  const sale = await createSale(s1, [[kurti.id, 1000, 1000]], [{ mode: 'upi', amount: 1000 }]);
  const wrongPay = await api(admin, 'PUT', `/api/bills/${sale.bill_id}`, editBody([[kurti.id, 1000, 900]], [{ mode: 'upi', amount: 1000 }]));
  assert.equal(wrongPay.status, 400, 'payments must equal the total');
  const aboveMrp = await api(admin, 'PUT', `/api/bills/${sale.bill_id}`, editBody([[kurti.id, 1000, 1100]], [{ mode: 'upi', amount: 1100 }]));
  assert.equal(aboveMrp.status, 400, 'no selling above MRP');
  assert.equal(bill(sale.bill_id).total, 1000, 'bill untouched after refused edits');
});

test('backdated bills never move the drawer when edited in place', async () => {
  const d = new Date(Date.now() + 5.5 * 3600e3 - 2 * 86400e3).toISOString().slice(0, 10);
  const res = await api(admin, 'POST', '/api/bills', { ...editBody([[kurti.id, 800, 800]], [{ mode: 'cash', amount: 800 }]), bill_date: d });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const drawerBefore = drawer();
  const edit = await api(admin, 'PUT', `/api/bills/${res.body.bill_id}`, editBody([[kurti.id, 800, 500]], [{ mode: 'cash', amount: 500 }]));
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(drawer(), drawerBefore);
  const after = bill(res.body.bill_id);
  assert.equal(after.is_backdated, 1);
  assert.match(after.notes, /^\[Backdated\]/);
});

test('in-place edit is refused for salesmen, active returns, returns and closed quarters', async () => {
  const sale = await createSale(s1, [[kurti.id, 1000, 1000]], [{ mode: 'cash', amount: 1000 }]);
  const body = editBody([[kurti.id, 1000, 900]], [{ mode: 'cash', amount: 900 }]);
  assert.equal((await api(s1, 'PUT', `/api/bills/${sale.bill_id}`, body)).status, 403, 'salesman');

  const ret = await api(admin, 'POST', `/api/bills/${sale.bill_id}/return`, {
    items: [{ bill_item_id: billItems(sale.bill_id)[0].id, quantity: 1 }], refund_mode: 'cash',
  });
  assert.equal(ret.status, 201);
  assert.equal((await api(admin, 'PUT', `/api/bills/${sale.bill_id}`, body)).status, 409, 'active return');
  assert.equal((await api(admin, 'PUT', `/api/bills/${ret.body.bill_id}`, body)).status, 400, 'a return bill');

  // Once the return is cancelled the sale can be edited again; the cancelled
  // return's link to the old line is cleared.
  assert.equal((await api(admin, 'DELETE', `/api/bills/${ret.body.bill_id}`)).status, 200);
  const ok = await api(admin, 'PUT', `/api/bills/${sale.bill_id}`, body);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(billItems(ret.body.bill_id)[0].orig_bill_item_id, null);

  const old = await createSale(s1, [[kurti.id, 1000, 1000]], [{ mode: 'upi', amount: 1000 }]);
  setCreatedAt(old.bill_id, '2025-06-15 12:00:00');
  assert.equal((await api(admin, 'PUT', `/api/bills/${old.bill_id}`, editBody([[kurti.id, 1000, 900]], [{ mode: 'upi', amount: 900 }]))).status, 403, 'closed quarter');
});

test("Hisaab explains an earlier day's bill edited in place today", async () => {
  const sale = await createSale(s1, [[kurti.id, 1000, 1000]], [{ mode: 'cash', amount: 1000 }]);
  setCreatedAt(sale.bill_id, `${yesterday()} 18:00:00`);
  const before = (await api(admin, 'GET', '/api/hisaab')).body;
  const res = await api(admin, 'PUT', `/api/bills/${sale.bill_id}`, editBody([[kurti.id, 1000, 850]], [{ mode: 'cash', amount: 850 }]));
  assert.equal(res.status, 200);
  const after = (await api(admin, 'GET', '/api/hisaab')).body;
  assert.equal(after.cash_adjustment - before.cash_adjustment, -150);
  assert.equal(after.cash_drawer - before.cash_drawer, -150);
});

test('salesmen can edit (linked reissue) and cancel their own bills for 1 hour', async () => {
  const body = (id) => ({ ...editBody([[kurti.id, 1000, 900]], [{ mode: 'upi', amount: 900 }]), replaces_bill_id: id });

  const recent = await createSale(s1, [[kurti.id, 1000, 1000]], [{ mode: 'upi', amount: 1000 }], { salesman_id: s1.id });
  setCreatedAt(recent.bill_id, istMinutesAgo(50));
  const edited = await api(s1, 'POST', '/api/bills', body(recent.bill_id));
  assert.equal(edited.status, 201, `edit at 50 min: ${JSON.stringify(edited.body)}`);
  assert.ok(bill(recent.bill_id).deleted_at, 'old bill cancelled and kept');
  assert.equal(bill(edited.body.bill_id).replaces_bill_id, recent.bill_id, 'new bill linked');
  const toCancel = await createSale(s1, [[kurti.id, 1000, 1000]], [{ mode: 'upi', amount: 1000 }], { salesman_id: s1.id });
  setCreatedAt(toCancel.bill_id, istMinutesAgo(55));
  assert.equal((await api(s1, 'DELETE', `/api/bills/${toCancel.bill_id}`)).status, 200, 'cancel at 55 min');

  const late = await createSale(s1, [[kurti.id, 1000, 1000]], [{ mode: 'upi', amount: 1000 }], { salesman_id: s1.id });
  setCreatedAt(late.bill_id, istMinutesAgo(70));
  assert.equal((await api(s1, 'POST', '/api/bills', body(late.bill_id))).status, 403, 'edit at 70 min');
  assert.equal((await api(s1, 'DELETE', `/api/bills/${late.bill_id}`)).status, 403, 'cancel at 70 min');

  const others = await createSale(s2, [[kurti.id, 1000, 1000]], [{ mode: 'upi', amount: 1000 }], { salesman_id: s2.id });
  assert.equal((await api(s1, 'DELETE', `/api/bills/${others.bill_id}`)).status, 403, "not someone else's bill");
});
