import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, createSale, users, categories, bill, billItems, queryOne } from './helpers.mjs';

const { admin, s1 } = users();
const [kurti] = categories();

test('phone numbers are cleaned up and linked to one customer', async () => {
  const a = await createSale(s1, [[kurti.id, 500, 500]], [{ mode: 'upi', amount: 500 }], { customer_phone: '+91 98765-43210', customer_name: 'Sunita' });
  const b = await createSale(s1, [[kurti.id, 700, 700]], [{ mode: 'upi', amount: 700 }], { customer_phone: '09876543210', customer_name: 'Pooja' });
  const ca = bill(a.bill_id), cb = bill(b.bill_id);
  assert.ok(ca.customer_id);
  assert.equal(ca.customer_id, cb.customer_id, 'same household');
  assert.equal(queryOne('SELECT phone FROM customers WHERE id = ?', ca.customer_id).phone, '9876543210');
  assert.equal(ca.customer_name, 'Sunita', 'each bill keeps the name typed on it');
  assert.equal(cb.customer_name, 'Pooja');
});

test('an invalid number is refused; no number saves exactly as before', async () => {
  const bad = await api(s1, 'POST', '/api/bills', {
    items: [{ category_id: kurti.id, mrp: 500, quantity: 1, amount: 500 }],
    payments: [{ mode: 'upi', amount: 500 }], customer_phone: '12345',
  });
  assert.equal(bad.status, 400);
  const plain = await createSale(s1, [[kurti.id, 500, 500]], [{ mode: 'upi', amount: 500 }]);
  assert.equal(bill(plain.bill_id).customer_id, null);
});

test('lookup finds a returning customer with their visit count', async () => {
  await createSale(s1, [[kurti.id, 500, 500]], [{ mode: 'upi', amount: 500 }], { customer_phone: '9123456780', customer_name: 'Meena' });
  const res = await api(s1, 'GET', '/api/customers/lookup?phone=%2B91%209123456780');
  assert.equal(res.status, 200);
  assert.equal(res.body.customer.name, 'Meena');
  assert.equal(res.body.customer.visits, 1);
  const none = await api(s1, 'GET', '/api/customers/lookup?phone=9000000001');
  assert.equal(none.body.customer, null);
});

test('a name left blank keeps the known customer name on the bill', async () => {
  await createSale(s1, [[kurti.id, 500, 500]], [{ mode: 'upi', amount: 500 }], { customer_phone: '9811122233', customer_name: 'Rekha' });
  const b = await createSale(s1, [[kurti.id, 500, 500]], [{ mode: 'upi', amount: 500 }], { customer_phone: '9811122233' });
  assert.equal(bill(b.bill_id).customer_name, 'Rekha');
});

test('a return belongs to the same customer', async () => {
  const b = await createSale(s1, [[kurti.id, 600, 600]], [{ mode: 'upi', amount: 600 }], { customer_phone: '9822233344', customer_name: 'Asha' });
  const ret = await api(s1, 'POST', `/api/bills/${b.bill_id}/return`, {
    items: [{ bill_item_id: billItems(b.bill_id)[0].id, quantity: 1 }], refund_mode: 'cash',
  });
  assert.equal(bill(ret.body.bill_id).customer_id, bill(b.bill_id).customer_id);
});

test('Bill badlo carries the customer over', async () => {
  const old = await createSale(s1, [[kurti.id, 600, 600]], [{ mode: 'upi', amount: 600 }], { customer_phone: '9833344455', customer_name: 'Kavita' });
  const res = await api(s1, 'POST', '/api/bills', {
    items: [{ category_id: kurti.id, mrp: 600, quantity: 1, amount: 550 }], payments: [{ mode: 'upi', amount: 550 }],
    replaces_bill_id: old.bill_id, customer_phone: '9833344455', customer_name: 'Kavita',
  });
  assert.equal(res.status, 201);
  assert.equal(bill(res.body.bill_id).customer_id, bill(old.bill_id).customer_id);
});

test('customer list shows visits and spend net of returns; salesmen cannot see it', async () => {
  const b = await createSale(s1, [[kurti.id, 1000, 1000]], [{ mode: 'upi', amount: 1000 }], { customer_phone: '9844455566', customer_name: 'Nisha' });
  await createSale(s1, [[kurti.id, 400, 400]], [{ mode: 'upi', amount: 400 }], { customer_phone: '9844455566' });
  await api(s1, 'POST', `/api/bills/${b.bill_id}/return`, {
    items: [{ bill_item_id: billItems(b.bill_id)[0].id, quantity: 1 }], refund_mode: 'upi',
  });
  const res = await api(admin, 'GET', '/api/customers?q=Nisha');
  const nisha = res.body.customers.find(c => c.phone === '9844455566');
  assert.equal(nisha.visits, 2);
  assert.equal(nisha.spend, 400);
  assert.equal((await api(s1, 'GET', '/api/customers')).status, 403);
  const csv = await api(admin, 'GET', '/api/customers?format=csv');
  assert.match(csv.body, /9844455566/);
});

test('Bill Book search finds bills across all dates by number, phone, name and amount', async () => {
  const d = new Date(Date.now() + 5.5 * 3600e3 - 20 * 86400e3).toISOString().slice(0, 10);
  const old = await createSale(admin, [[kurti.id, 1337, 1337]], [{ mode: 'upi', amount: 1337 }],
    { bill_date: d, customer_phone: '9855566677', customer_name: 'Farida' });
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const find = async q => (await api(s1, 'GET', `/api/bills?q=${encodeURIComponent(q)}&from=${today}&to=${today}`)).body.bills.map(b => b.id);
  const num = bill(old.bill_id).bill_number;
  assert.ok((await find(num)).includes(old.bill_id), 'by bill number');
  assert.ok((await find(num.replace('MJF-', ''))).includes(old.bill_id), 'by number digits');
  assert.ok((await find('55566677')).includes(old.bill_id), 'by partial phone');
  assert.ok((await find('farida')).includes(old.bill_id), 'by name');
  assert.ok((await find('1337')).includes(old.bill_id), 'by amount');
});
