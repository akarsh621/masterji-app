import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { api, users, queryOne, token } from './helpers.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');

const { admin } = users();

async function newSalesman(name) {
  const pin = String(1000 + Math.floor(Math.random() * 9000));
  const res = await api(admin, 'POST', '/api/users', { name, role: 'salesman', pin });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return queryOne('SELECT * FROM users WHERE name = ? ORDER BY id DESC', name);
}

test('a bad PIN rejects the whole edit, so the name does not change either', async () => {
  const u = await newSalesman('Edit Test');
  const res = await api(admin, 'PATCH', `/api/users/${u.id}`, { name: 'Changed Name', pin: '12' });
  assert.equal(res.status, 400);
  const after = queryOne('SELECT name, pin FROM users WHERE id = ?', u.id);
  assert.equal(after.name, 'Edit Test');
  assert.equal(after.pin, u.pin);
});

test('deleting a user with only a cash-out on record deactivates instead of failing', async () => {
  const u = await newSalesman('History Test');
  // Cash-out is admin-only now, but prod has older cash-outs recorded by salesmen.
  const conn = new Database(path.join(process.env.DATA_DIR, 'masterji_dev.db'));
  conn.prepare("INSERT INTO cash_out (amount, reason, recorded_by) VALUES (10, 'other', ?)").run(u.id);
  conn.close();
  const res = await api(admin, 'DELETE', `/api/users/${u.id}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const after = queryOne('SELECT active FROM users WHERE id = ?', u.id);
  assert.equal(after.active, 0, 'kept, but deactivated');
});

test('a user with no history is actually deleted', async () => {
  const u = await newSalesman('No History');
  const res = await api(admin, 'DELETE', `/api/users/${u.id}`);
  assert.equal(res.status, 200);
  assert.equal(queryOne('SELECT id FROM users WHERE id = ?', u.id), undefined);
});

test('malformed JSON is a 400, not a 500', async () => {
  const res = await fetch(process.env.BASE_URL + '/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(admin)}` },
    body: '{not json',
  });
  assert.equal(res.status, 400);
});
