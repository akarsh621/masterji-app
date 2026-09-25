import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, BASE_URL, createSale, users, categories } from './helpers.mjs';

const { admin, s1 } = users();
const [kurti] = categories();
let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter}`;

async function login(body, ip) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify(body),
  });
  return res.status;
}

// Dev seed: Salesman 1 has PIN 1111, admin/admin123 (test database only).
test('after 5 wrong PINs from one phone, even the right PIN is refused there for a while', async () => {
  const ip = freshIp();
  for (let i = 0; i < 5; i++) assert.equal(await login({ salesman_id: s1.id, pin: '0000' }, ip), 401);
  assert.equal(await login({ salesman_id: s1.id, pin: '1111' }, ip), 429);
});

test('the same salesman can still log in from a different phone', async () => {
  const bad = freshIp();
  for (let i = 0; i < 5; i++) await login({ salesman_id: s1.id, pin: '0000' }, bad);
  assert.equal(await login({ salesman_id: s1.id, pin: '1111' }, freshIp()), 200);
});

test('a correct login clears earlier mistakes from that phone', async () => {
  const ip = freshIp();
  for (let i = 0; i < 4; i++) await login({ salesman_id: s1.id, pin: '0000' }, ip);
  assert.equal(await login({ salesman_id: s1.id, pin: '1111' }, ip), 200);
  for (let i = 0; i < 4; i++) assert.equal(await login({ salesman_id: s1.id, pin: '0000' }, ip), 401);
  assert.equal(await login({ salesman_id: s1.id, pin: '1111' }, ip), 200);
});

test('admin password guessing is limited too', async () => {
  const ip = freshIp();
  for (let i = 0; i < 5; i++) assert.equal(await login({ username: 'admin', password: 'wrong' }, ip), 401);
  assert.equal(await login({ username: 'admin', password: 'admin123' }, ip), 429);
  assert.equal(await login({ username: 'admin', password: 'admin123' }, freshIp()), 200);
});

test('salesmen cannot record or read cash-outs, or open Hisaab', async () => {
  assert.equal((await api(s1, 'POST', '/api/cash-out', { amount: 500, reason: 'owner' })).status, 403);
  assert.equal((await api(s1, 'POST', '/api/cash-out', { amount: 500, reason: 'manual', note: 'x' })).status, 403);
  assert.equal((await api(s1, 'GET', '/api/cash-out')).status, 403);
  assert.equal((await api(s1, 'GET', '/api/hisaab')).status, 403);
  assert.equal((await api(admin, 'GET', '/api/hisaab')).status, 200);
});

test("salesmen only get today's dashboard figures, whatever range they ask for", async () => {
  const today = await api(s1, 'GET', '/api/dashboard?view=today');
  const asked = await api(s1, 'GET', '/api/dashboard?from=2020-01-01&to=2030-12-31');
  assert.equal(asked.status, 200);
  assert.deepEqual(asked.body.summary ?? asked.body, today.body.summary ?? today.body);
});

test('salesmen can still browse Bill Book for any date', async () => {
  const res = await api(s1, 'GET', '/api/bills?from=2020-01-01&to=2030-12-31');
  assert.equal(res.status, 200);
});

test('salesmen can queue a print but not read, change or clear the queue', async () => {
  const b = await createSale(s1, [[kurti.id, 400, 400]], [{ mode: 'upi', amount: 400 }]);
  const q = await api(s1, 'POST', '/api/print-queue', { bill_id: b.bill_id });
  assert.equal(q.status, 201);
  assert.equal((await api(s1, 'GET', '/api/print-queue')).status, 403);
  assert.equal((await api(s1, 'PATCH', `/api/print-queue/${q.body.id}`, { status: 'printed' })).status, 403);
  assert.equal((await api(s1, 'DELETE', '/api/print-queue')).status, 403);
});
