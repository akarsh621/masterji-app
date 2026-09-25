import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { api, createSale, saleBody, drawer, users, categories, bill, billItems } from './helpers.mjs';

const { admin, s1, s2 } = users();
const [kurti, top] = categories();
const daysAgo = n => new Date(Date.now() + 5.5 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
const replace = (user, oldId, lines, payments, extra = {}) =>
  api(user, 'POST', '/api/bills', saleBody(lines, payments, { replaces_bill_id: oldId, ...extra }));

test('correcting a ₹960 cash bill to ₹900 cash moves the drawer by exactly -₹60', async () => {
  const old = await createSale(s1, [[kurti.id, 1200, 960]], [{ mode: 'cash', amount: 960 }]);
  const before = drawer();
  const res = await replace(s1, old.bill_id, [[kurti.id, 1200, 900]], [{ mode: 'cash', amount: 900 }]);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(drawer(), before - 60);

  const oldRow = bill(old.bill_id);
  const newRow = bill(res.body.bill_id);
  assert.ok(oldRow.deleted_at, 'old bill is cancelled');
  assert.equal(newRow.replaces_bill_id, old.bill_id);
  assert.equal(newRow.created_at, oldRow.created_at, 'keeps the original date');
  assert.equal(newRow.salesman_id, s1.id);
  assert.equal(res.body.replaces_bill_number, oldRow.bill_number);
});

test('switching a correction from cash to UPI takes the old cash back out', async () => {
  const old = await createSale(s1, [[kurti.id, 500, 500]], [{ mode: 'cash', amount: 500 }]);
  const before = drawer();
  const res = await replace(s1, old.bill_id, [[kurti.id, 500, 500]], [{ mode: 'upi', amount: 500 }]);
  assert.equal(res.status, 201);
  assert.equal(drawer(), before - 500);
});

test('an invalid correction changes nothing', async () => {
  const old = await createSale(s1, [[kurti.id, 800, 800]], [{ mode: 'cash', amount: 800 }]);
  const before = drawer();
  const res = await replace(s1, old.bill_id, [[kurti.id, 800, 700]], [{ mode: 'cash', amount: 650 }]);
  assert.equal(res.status, 400);
  assert.equal(bill(old.bill_id).deleted_at, null, 'old bill untouched');
  assert.equal(drawer(), before);
});

test("a salesman can't correct someone else's bill", async () => {
  const old = await createSale(s2, [[kurti.id, 800, 800]], [{ mode: 'upi', amount: 800 }]);
  const res = await replace(s1, old.bill_id, [[kurti.id, 800, 700]], [{ mode: 'upi', amount: 700 }]);
  assert.equal(res.status, 403);
  assert.equal(bill(old.bill_id).deleted_at, null);
});

test('a salesman cannot correct an old bill; admin can, and it keeps the salesman', async () => {
  const old = await createSale(admin, [[kurti.id, 800, 800]], [{ mode: 'upi', amount: 800 }], { bill_date: daysAgo(2), salesman_id: s1.id });
  assert.equal((await replace(s1, old.bill_id, [[kurti.id, 800, 700]], [{ mode: 'upi', amount: 700 }])).status, 403);
  const res = await replace(admin, old.bill_id, [[kurti.id, 800, 700]], [{ mode: 'upi', amount: 700 }]);
  assert.equal(res.status, 201);
  assert.equal(bill(res.body.bill_id).salesman_id, s1.id);
});

test('correcting a backdated cash bill never touches the drawer', async () => {
  const old = await createSale(admin, [[kurti.id, 1000, 1000]], [{ mode: 'cash', amount: 1000 }], { bill_date: daysAgo(3) });
  const before = drawer();
  const res = await replace(admin, old.bill_id, [[kurti.id, 1000, 900]], [{ mode: 'cash', amount: 900 }]);
  assert.equal(res.status, 201);
  assert.equal(drawer(), before);
  assert.equal(bill(res.body.bill_id).is_backdated, 1);
});

test('a bill with an active return cannot be corrected', async () => {
  const old = await createSale(s1, [[kurti.id, 800, 800], [top.id, 400, 400]], [{ mode: 'upi', amount: 1200 }]);
  const ret = await api(s1, 'POST', `/api/bills/${old.bill_id}/return`, {
    items: [{ bill_item_id: billItems(old.bill_id)[1].id, quantity: 1 }], refund_mode: 'upi',
  });
  assert.equal(ret.status, 201);
  const res = await replace(s1, old.bill_id, [[kurti.id, 800, 800]], [{ mode: 'upi', amount: 800 }]);
  assert.equal(res.status, 409);
});

test('an already-cancelled bill cannot be corrected', async () => {
  const old = await createSale(s1, [[kurti.id, 800, 800]], [{ mode: 'upi', amount: 800 }]);
  await api(s1, 'DELETE', `/api/bills/${old.bill_id}`);
  const res = await replace(s1, old.bill_id, [[kurti.id, 800, 700]], [{ mode: 'upi', amount: 700 }]);
  assert.equal(res.status, 404);
});

test('retrying a correction after a lost response does not create a second bill', async () => {
  const old = await createSale(s1, [[kurti.id, 900, 900]], [{ mode: 'cash', amount: 900 }]);
  const before = drawer();
  const extra = { client_request_id: randomUUID() };
  const first = await replace(s1, old.bill_id, [[kurti.id, 900, 850]], [{ mode: 'cash', amount: 850 }], extra);
  const second = await replace(s1, old.bill_id, [[kurti.id, 900, 850]], [{ mode: 'cash', amount: 850 }], extra);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.bill_id, first.body.bill_id);
  assert.equal(drawer(), before - 50);
});
