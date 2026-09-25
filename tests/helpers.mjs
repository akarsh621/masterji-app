// Shared helpers for the integration tests. Everything talks to the real API
// started by tests/run.mjs; the DB is opened read-only only for assertions.
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

export const BASE_URL = process.env.BASE_URL;
const DB_PATH = path.join(process.env.DATA_DIR, 'masterji_dev.db');

export function db() {
  return new Database(DB_PATH, { readonly: true, fileMustExist: true });
}

function query(sql, ...params) {
  const conn = db();
  try { return conn.prepare(sql).all(...params); } finally { conn.close(); }
}

export function queryOne(sql, ...params) {
  return query(sql, ...params)[0];
}

export function users() {
  const rows = query('SELECT id, name, role FROM users ORDER BY id');
  const salesmen = rows.filter(u => u.role === 'salesman');
  return { admin: rows.find(u => u.role === 'admin'), s1: salesmen[0], s2: salesmen[1] };
}

export function categories() {
  return query('SELECT id, name FROM categories WHERE active = 1 ORDER BY id');
}

export function drawer() {
  return queryOne('SELECT cash_drawer FROM app_state WHERE id = 1').cash_drawer;
}

export function token(user) {
  return jwt.sign({ id: user.id, name: user.name, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

export async function api(user, method, url, body, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (user) headers.Authorization = `Bearer ${token(user)}`;
  const res = await fetch(BASE_URL + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

// Builds a sale. `lines` are [categoryId, mrp, sellingPricePerPiece, qty].
export function saleBody(lines, payments, extra = {}) {
  const items = lines.map(([category_id, mrp, price, quantity = 1]) => ({
    category_id, mrp, quantity, amount: price * quantity,
  }));
  return { items, payments, discount_percent: 0, discount_amount: 0, ...extra };
}

export async function createSale(user, lines, payments, extra) {
  const res = await api(user, 'POST', '/api/bills', saleBody(lines, payments, extra));
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`createSale failed ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.bill || res.body;
}

export function billItems(billId) {
  return query('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id', billId);
}

export function bill(billId) {
  return queryOne('SELECT * FROM bills WHERE id = ?', billId);
}
