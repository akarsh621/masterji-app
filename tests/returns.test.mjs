import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, createSale, drawer, users, categories, bill, billItems, queryOne } from './helpers.mjs';

const { admin, s1 } = users();
const [kurti, top] = categories();

const lineIds = billId => billItems(billId).map(i => i.id);
const doReturn = (user, billId, items, refund_mode = 'cash', extra = {}) =>
  api(user, 'POST', `/api/bills/${billId}/return`, { items, refund_mode, ...extra });

test('two lines of the same category at different prices: the right one is returned', async () => {
  const b = await createSale(s1, [[kurti.id, 500, 500], [kurti.id, 1500, 1500]], [{ mode: 'upi', amount: 2000 }]);
  const [cheap, dear] = lineIds(b.bill_id);
  const res = await doReturn(s1, b.bill_id, [{ bill_item_id: dear, quantity: 1 }], 'upi');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.refund_amount, 1500);
  // The cheaper line is still fully returnable afterwards.
  const res2 = await doReturn(s1, b.bill_id, [{ bill_item_id: cheap, quantity: 1 }], 'upi');
  assert.equal(res2.status, 201, JSON.stringify(res2.body));
  assert.equal(res2.body.refund_amount, 500);
});

test('repeating the same line in one request cannot refund it twice', async () => {
  const b = await createSale(s1, [[kurti.id, 1500, 1500]], [{ mode: 'cash', amount: 1500 }]);
  const [line] = lineIds(b.bill_id);
  const before = drawer();
  const res = await doReturn(s1, b.bill_id, [{ bill_item_id: line, quantity: 1 }, { bill_item_id: line, quantity: 1 }]);
  assert.equal(res.status, 400);
  assert.equal(drawer(), before);
});

test('refund is capped at what was paid after a bill-level discount', async () => {
  // 1000 + 1000 = 2000, final price set to 1800.
  const b = await createSale(s1, [[kurti.id, 1000, 1000], [top.id, 1000, 1000]], [{ mode: 'cash', amount: 1800 }], { discount_amount: 200 });
  assert.equal(b.total, 1800);
  const [a, c] = lineIds(b.bill_id);
  const one = await doReturn(s1, b.bill_id, [{ bill_item_id: a, quantity: 1 }]);
  assert.equal(one.body.refund_amount, 900);
  const two = await doReturn(s1, b.bill_id, [{ bill_item_id: c, quantity: 1 }]);
  assert.equal(two.body.refund_amount, 900);
});

test('refund respects the cash round-off', async () => {
  const b = await createSale(s1, [[kurti.id, 1995, 1995]], [{ mode: 'cash', amount: 1990 }], { discount_amount: 5 });
  const [line] = lineIds(b.bill_id);
  const res = await doReturn(s1, b.bill_id, [{ bill_item_id: line, quantity: 1 }]);
  assert.equal(res.body.refund_amount, 1990);
});

test('total refunds on a bill never exceed its total', async () => {
  const b = await createSale(s1, [[kurti.id, 999, 333, 3]], [{ mode: 'cash', amount: 990 }], { discount_amount: 9 });
  const [line] = lineIds(b.bill_id);
  let refunded = 0;
  for (let i = 0; i < 3; i++) {
    const res = await doReturn(s1, b.bill_id, [{ bill_item_id: line, quantity: 1 }]);
    assert.equal(res.status, 201);
    refunded += res.body.refund_amount;
  }
  assert.ok(Math.abs(refunded - 990) < 0.011, `refunded ${refunded}`);
  const over = await doReturn(s1, b.bill_id, [{ bill_item_id: line, quantity: 1 }]);
  assert.equal(over.status, 400);
});

test('a return is credited to the original salesman, not whoever processed it', async () => {
  const b = await createSale(s1, [[kurti.id, 800, 800]], [{ mode: 'upi', amount: 800 }]);
  const res = await doReturn(admin, b.bill_id, [{ bill_item_id: lineIds(b.bill_id)[0], quantity: 1 }], 'upi');
  assert.equal(bill(res.body.bill_id).salesman_id, s1.id);
});

test('salesmen can only return bills up to 7 days old; admin any age', async () => {
  const d = new Date(Date.now() + 5.5 * 3600e3 - 8 * 86400e3).toISOString().slice(0, 10);
  const b = await createSale(admin, [[kurti.id, 800, 800]], [{ mode: 'upi', amount: 800 }], { bill_date: d, salesman_id: s1.id });
  const [line] = lineIds(b.bill_id);
  assert.equal((await doReturn(s1, b.bill_id, [{ bill_item_id: line, quantity: 1 }], 'upi')).status, 403);
  assert.equal((await doReturn(admin, b.bill_id, [{ bill_item_id: line, quantity: 1 }], 'upi')).status, 201);
});

test('refunds can be cash or UPI, never card', async () => {
  const b = await createSale(s1, [[kurti.id, 800, 800]], [{ mode: 'card', amount: 800 }]);
  const res = await doReturn(s1, b.bill_id, [{ bill_item_id: lineIds(b.bill_id)[0], quantity: 1 }], 'card');
  assert.equal(res.status, 400);
});

test('a cash refund comes out of the drawer; a UPI refund does not', async () => {
  const b = await createSale(s1, [[kurti.id, 800, 800], [top.id, 600, 600]], [{ mode: 'cash', amount: 1400 }]);
  const [a, c] = lineIds(b.bill_id);
  let before = drawer();
  await doReturn(s1, b.bill_id, [{ bill_item_id: a, quantity: 1 }], 'cash');
  assert.equal(drawer(), before - 800);
  before = drawer();
  await doReturn(s1, b.bill_id, [{ bill_item_id: c, quantity: 1 }], 'upi');
  assert.equal(drawer(), before);
});

test('old clients sending category_id still work, spread across matching lines', async () => {
  const b = await createSale(s1, [[kurti.id, 500, 500], [kurti.id, 1500, 1500]], [{ mode: 'upi', amount: 2000 }]);
  const res = await doReturn(s1, b.bill_id, [{ category_id: kurti.id, quantity: 2, amount: 2000 }], 'upi');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.refund_amount, 2000);
});

test('a line cannot be returned more times than it was sold', async () => {
  const b = await createSale(s1, [[kurti.id, 500, 500, 2]], [{ mode: 'upi', amount: 1000 }]);
  const [line] = lineIds(b.bill_id);
  assert.equal((await doReturn(s1, b.bill_id, [{ bill_item_id: line, quantity: 3 }], 'upi')).status, 400);
  assert.equal((await doReturn(s1, b.bill_id, [{ bill_item_id: line, quantity: 2 }], 'upi')).status, 201);
  assert.equal((await doReturn(s1, b.bill_id, [{ bill_item_id: line, quantity: 1 }], 'upi')).status, 400);
});

test('a line from a different bill is rejected', async () => {
  const a = await createSale(s1, [[kurti.id, 500, 500]], [{ mode: 'upi', amount: 500 }]);
  const b = await createSale(s1, [[kurti.id, 700, 700]], [{ mode: 'upi', amount: 700 }]);
  const res = await doReturn(s1, a.bill_id, [{ bill_item_id: lineIds(b.bill_id)[0], quantity: 1 }], 'upi');
  assert.equal(res.status, 400);
});

test('return lines record which original line they came from', async () => {
  const b = await createSale(s1, [[kurti.id, 500, 500], [kurti.id, 1500, 1500]], [{ mode: 'upi', amount: 2000 }]);
  const [, dear] = lineIds(b.bill_id);
  const res = await doReturn(s1, b.bill_id, [{ bill_item_id: dear, quantity: 1 }], 'upi');
  const row = queryOne('SELECT orig_bill_item_id FROM bill_items WHERE bill_id = ?', res.body.bill_id);
  assert.equal(row.orig_bill_item_id, dear);
});
