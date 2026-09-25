import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, createSale, saleBody, drawer, users, categories, bill, queryOne } from './helpers.mjs';

const { admin, s1, s2 } = users();
const [kurti, top] = categories();

test('cash sale adds its total to the drawer', async () => {
  const before = drawer();
  const b = await createSale(s1, [[kurti.id, 1000, 800]], [{ mode: 'cash', amount: 800 }]);
  assert.equal(b.total, 800);
  assert.equal(drawer(), before + 800);
});

test('UPI and card sales do not touch the drawer', async () => {
  const before = drawer();
  await createSale(s1, [[kurti.id, 1000, 900]], [{ mode: 'upi', amount: 900 }]);
  await createSale(s1, [[top.id, 500, 500]], [{ mode: 'card', amount: 500 }]);
  assert.equal(drawer(), before);
});

test('split cash + UPI adds only the cash part to the drawer', async () => {
  const before = drawer();
  const b = await createSale(s1, [[kurti.id, 2000, 1500]], [{ mode: 'cash', amount: 500 }, { mode: 'upi', amount: 1000 }]);
  assert.equal(b.payment_mode, 'mixed');
  assert.equal(drawer(), before + 500);
});

test('payments that do not add up to the total are rejected', async () => {
  const res = await api(s1, 'POST', '/api/bills', {
    items: [{ category_id: kurti.id, mrp: 1000, quantity: 1, amount: 900 }],
    payments: [{ mode: 'cash', amount: 800 }],
  });
  assert.equal(res.status, 400);
});

test('selling price above MRP is rejected', async () => {
  const res = await api(s1, 'POST', '/api/bills', {
    items: [{ category_id: kurti.id, mrp: 500, quantity: 1, amount: 600 }],
    payments: [{ mode: 'upi', amount: 600 }],
  });
  assert.equal(res.status, 400);
});

test('voiding a cash sale takes its cash back out of the drawer', async () => {
  const b = await createSale(s1, [[kurti.id, 1000, 700]], [{ mode: 'cash', amount: 700 }]);
  const before = drawer();
  const res = await api(s1, 'DELETE', `/api/bills/${b.bill_id}`);
  assert.equal(res.status, 200);
  assert.equal(drawer(), before - 700);
  assert.ok(bill(b.bill_id).deleted_at);
});

test("a salesman cannot void another salesman's bill", async () => {
  const b = await createSale(s2, [[kurti.id, 1000, 700]], [{ mode: 'upi', amount: 700 }]);
  const res = await api(s1, 'DELETE', `/api/bills/${b.bill_id}`);
  assert.equal(res.status, 403);
});

test('requests without a login are refused', async () => {
  const res = await api(null, 'GET', '/api/bills');
  assert.equal(res.status, 401);
});

test('seeded users exist for the tests', () => {
  assert.ok(admin && s1 && s2);
  assert.equal(queryOne("SELECT COUNT(*) AS n FROM users WHERE role = 'salesman'").n >= 2, true);
});

test('UPI QR is gone, but UPI and mixed payments still work', async () => {
  assert.equal(queryOne("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'upi_accounts'").n, 0);
  assert.equal((await api(admin, 'GET', '/api/upi-accounts')).status, 404);
  assert.equal((await api(s1, 'GET', '/api/upi-qr?account_id=1&amount=10')).status, 404);
  const upi = await createSale(s1, [[kurti.id, 300, 300]], [{ mode: 'upi', amount: 300 }]);
  assert.equal(upi.payment_mode, 'upi');
  const mixed = await createSale(s1, [[kurti.id, 300, 300]], [{ mode: 'cash', amount: 100 }, { mode: 'upi', amount: 200 }]);
  assert.equal(mixed.payment_mode, 'mixed');
});

test('an MRP above the per-piece limit is refused (typing slip, e.g. 17991799)', async () => {
  const [cat] = categories();
  const res = await api(users().s1, 'POST', '/api/bills', saleBody([[cat.id, 17991799, 17991799]], [{ mode: 'cash', amount: 17991799 }]));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /MRP/);
  const ok = await api(users().s1, 'POST', '/api/bills', saleBody([[cat.id, 25000, 25000]], [{ mode: 'upi', amount: 25000 }]));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});
