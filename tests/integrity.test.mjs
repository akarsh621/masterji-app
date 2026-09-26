// Money integrity stress test.
//
// Runs a long, random but reproducible mix of real shop activity -- sales with
// item discounts, final prices, cash round-off, split payments with paise,
// backdated bills, returns (partial, repeated, last-piece), cancelled returns,
// cancelled bills, edited bills, bills from earlier days, cash-outs and retried
// requests -- while keeping its OWN record of what every figure must be.
// Then it checks the database, the cash drawer and every report (Dashboard,
// Earnings, Hisaab, CSV export, customers) against that record.
//
// SEED=123 npm test integrity   -- replay a specific run
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { api, users, categories, drawer, billItems, db as openDb } from './helpers.mjs';
import { auditDatabase } from '../scripts/money-audit.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const DB_FILE = path.join(process.env.DATA_DIR, 'masterji_dev.db');

const { admin, s1, s2 } = users();
const cats = categories();
const SEED = Number(process.env.SEED) || 20260927;
const OPS = Number(process.env.OPS) || 250;

// Small deterministic PRNG (mulberry32) so a failing run can be replayed.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const int = (n) => Math.floor(rand() * n);
const pick = (list) => list[int(list.length)];
const r2 = (v) => Math.round(v * 100) / 100;
const near = (a, b, msg, eps = 0.011) => assert.ok(Math.abs(a - b) <= eps, `${msg}: got ${a}, expected ${b}`);

const IST_NOW = () => new Date(Date.now() + 5.5 * 3600e3);
const todayYmd = () => IST_NOW().toISOString().slice(0, 10);
const daysAgoYmd = (n) => new Date(Date.now() + 5.5 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
const PHONES = ['9876500001', '9876500002', '9876500003'];

// ---------------------------------------------------------------- the model
// Everything the app should show, computed here without reading the app's numbers.
const model = {
  drawer: 0,            // expected change in the cash drawer during this test
  sales: new Map(),     // bill id -> sale record (live only)
  returns: new Map(),   // bill id -> return record (live only)
  agedCash: 0,          // cash of bills this test moved to an earlier day (see ageBill)
};

function genSaleBody(extra = {}) {
  const lines = [];
  for (let i = 0, n = 1 + int(3); i < n; i++) {
    const mrp = 50 * (2 + int(60)) + pick([0, 0, 49, 99]);
    const disc = pick([0, 0, 0, 10, 15, 20, 25, 33, 40]);
    const qty = 1 + int(3);
    const price = Math.min(Math.round(mrp * (1 - disc / 100)), mrp);
    lines.push({ category_id: pick(cats).id, mrp, quantity: qty, amount: price * qty });
  }
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);

  // Final price on ~30% of bills (bill-level discount).
  let billDisc = 0;
  if (rand() < 0.3) {
    const finalPrice = Math.floor((subtotal * (0.85 + rand() * 0.14)) / 10) * 10;
    if (finalPrice > 0 && finalPrice < subtotal) billDisc = subtotal - finalPrice;
  }
  const beforeRound = subtotal - billDisc;

  let payments;
  let roundOff = 0;
  const kind = rand();
  if (kind < 0.35) {
    const cash = beforeRound < 10 ? beforeRound : Math.floor(beforeRound / 10) * 10; // cash-only rounds down to ₹10
    roundOff = beforeRound - cash;
    payments = [{ mode: 'cash', amount: cash }];
  } else if (kind < 0.6) {
    payments = [{ mode: 'upi', amount: beforeRound }];
  } else if (kind < 0.8) {
    payments = [{ mode: 'card', amount: beforeRound }];
  } else {
    const first = r2(beforeRound * (0.2 + rand() * 0.6)); // split with paise
    payments = [{ mode: pick(['cash', 'upi']), amount: first }, { mode: pick(['card', 'upi', 'cash']), amount: r2(beforeRound - first) }];
  }
  const body = {
    items: lines,
    payments,
    discount_percent: 0,
    discount_amount: billDisc + roundOff,
    client_request_id: randomUUID(),
    salesman_id: pick([s1, s2]).id,
    ...extra,
  };
  if (rand() < 0.4) body.customer_phone = pick(PHONES);
  return { body, expectedTotal: r2(subtotal - billDisc - roundOff) };
}

const cashOf = (payments) => r2(payments.filter(p => p.mode === 'cash').reduce((s, p) => s + p.amount, 0));

function recordSale(res, body, { backdated, date, isEdit = false }) {
  const id = res.bill_id;
  const lines = billItems(id).map(l => ({ id: l.id, qty: l.quantity, amount: l.amount, returned: 0, category_id: l.category_id }));
  model.sales.set(id, {
    id, bill_number: res.bill_number, total: res.total, subtotal: res.subtotal,
    cash: cashOf(body.payments), payments: body.payments, backdated, date,
    phone: body.customer_phone || null, lines, refunded: 0, isEdit,
  });
}

const liveReturnsOf = (saleId) => [...model.returns.values()].filter(r => r.original === saleId);
const piecesLeft = (sale) => sale.lines.reduce((s, l) => s + l.qty - l.returned, 0);

// ---------------------------------------------------------------- operations
async function opSale({ backdated = false } = {}) {
  const extra = backdated ? { bill_date: daysAgoYmd(3) } : {};
  const { body, expectedTotal } = genSaleBody(extra);
  const res = await api(admin, 'POST', '/api/bills', body);
  assert.equal(res.status, 201, `sale refused: ${JSON.stringify(res.body)} for ${JSON.stringify(body)}`);
  near(res.body.total, expectedTotal, 'server total for a sale');
  recordSale(res.body, body, { backdated, date: backdated ? daysAgoYmd(3) : todayYmd() });
  if (!backdated) model.drawer = r2(model.drawer + cashOf(body.payments));

  // Now and then, the phone retries the same save (lost response): nothing new.
  if (rand() < 0.15) {
    const again = await api(admin, 'POST', '/api/bills', body);
    assert.equal(again.status, 200, 'a retried save must return the existing bill');
    assert.equal(again.body.bill_id, res.body.bill_id);
  }
}

async function opReturn() {
  const candidates = [...model.sales.values()].filter(s => piecesLeft(s) > 0);
  if (!candidates.length) return;
  const sale = pick(candidates);
  const line = pick(sale.lines.filter(l => l.qty - l.returned > 0));
  const qty = 1 + int(line.qty - line.returned);
  const mode = rand() < 0.75 ? 'cash' : 'upi';

  // Expected refund, worked out here from the rules: the line's share of what
  // was actually paid; the last pieces (or rounding past what's left) get
  // exactly what remains.
  const refundable = r2(sale.total - sale.refunded);
  let expected = r2(line.amount * (qty / line.qty) * (sale.total / sale.subtotal));
  if (piecesLeft(sale) - qty === 0 || expected > refundable) expected = refundable;

  const res = await api(admin, 'POST', `/api/bills/${sale.id}/return`, {
    items: [{ bill_item_id: line.id, quantity: qty }], refund_mode: mode, client_request_id: randomUUID(),
  });
  assert.equal(res.status, 201, `return refused: ${JSON.stringify(res.body)}`);
  near(res.body.refund_amount, expected, `refund for ${qty} of line ${line.id} on ${sale.bill_number}`);
  assert.ok(sale.refunded + res.body.refund_amount <= sale.total + 0.011, 'refunds never exceed what was paid');

  line.returned += qty;
  sale.refunded = r2(sale.refunded + res.body.refund_amount);
  model.returns.set(res.body.bill_id, {
    id: res.body.bill_id, original: sale.id, lineId: line.id, qty, total: res.body.refund_amount,
    mode, phone: sale.phone, date: todayYmd(),
  });
  if (mode === 'cash') model.drawer = r2(model.drawer - res.body.refund_amount);

  // Returning more than is left must be refused.
  if (line.qty - line.returned === 0) {
    const over = await api(admin, 'POST', `/api/bills/${sale.id}/return`, {
      items: [{ bill_item_id: line.id, quantity: 1 }], refund_mode: 'cash',
    });
    assert.equal(over.status, 400, 'returning a fully returned line must be refused');
  }
}

async function opCancelReturn() {
  if (!model.returns.size) return;
  const ret = pick([...model.returns.values()]);
  const res = await api(admin, 'DELETE', `/api/bills/${ret.id}`);
  assert.equal(res.status, 200, `cancel return refused: ${JSON.stringify(res.body)}`);
  const sale = model.sales.get(ret.original);
  sale.lines.find(l => l.id === ret.lineId).returned -= ret.qty;
  sale.refunded = r2(sale.refunded - ret.total);
  model.returns.delete(ret.id);
  if (ret.mode === 'cash') model.drawer = r2(model.drawer + ret.total);
}

async function opCancelSale() {
  if (!model.sales.size) return;
  const sale = pick([...model.sales.values()]);
  const res = await api(admin, 'DELETE', `/api/bills/${sale.id}`);
  if (liveReturnsOf(sale.id).length) {
    assert.equal(res.status, 409, 'a sale with an active return must not be cancellable');
    return;
  }
  assert.equal(res.status, 200, `cancel refused: ${JSON.stringify(res.body)}`);
  model.sales.delete(sale.id);
  if (!sale.backdated) model.drawer = r2(model.drawer - sale.cash);
}

async function opEditSale() {
  if (!model.sales.size) return;
  const sale = pick([...model.sales.values()]);
  const { body, expectedTotal } = genSaleBody({ replaces_bill_id: sale.id });
  const res = await api(admin, 'POST', '/api/bills', body);
  if (liveReturnsOf(sale.id).length) {
    assert.equal(res.status, 409, 'a sale with an active return must not be editable');
    return;
  }
  assert.equal(res.status, 201, `edit refused: ${JSON.stringify(res.body)}`);
  near(res.body.total, expectedTotal, 'server total for an edited bill');
  model.sales.delete(sale.id);
  recordSale(res.body, body, { backdated: sale.backdated, date: sale.date, isEdit: true });
  // Only the cash difference moves the drawer, and never for backdated bills.
  if (!sale.backdated) model.drawer = r2(model.drawer + cashOf(body.payments) - sale.cash);
}

async function opCashOut() {
  const amount = 100 * (1 + int(20));
  const res = await api(admin, 'POST', '/api/cash-out', {
    amount, reason: 'other', note: 'integrity test', client_request_id: randomUUID(),
  });
  assert.ok(res.status === 201 || res.status === 200, `cash-out refused: ${JSON.stringify(res.body)}`);
  model.drawer = r2(model.drawer - amount);
}

// Moves a live, non-backdated sale (made "live" earlier in this test) to
// yesterday, as if it had been billed yesterday. Its cash really entered the
// drawer during this test, so Hisaab (today's view) will no longer list it --
// tracked in agedCash so the Hisaab check can account for it.
function ageBill() {
  const candidates = [...model.sales.values()].filter(s => !s.backdated && !s.isEdit && s.date === todayYmd());
  if (!candidates.length) return;
  const sale = pick(candidates);
  const yesterday = daysAgoYmd(1);
  const conn = new Database(DB_FILE);
  conn.prepare("UPDATE bills SET created_at = ? || ' 18:00:00' WHERE id = ?").run(yesterday, sale.id);
  conn.close();
  sale.date = yesterday;
  model.agedCash = r2(model.agedCash + sale.cash);
}

// ---------------------------------------------------------------- report readers
async function reports() {
  const today = todayYmd();
  const dash = (await api(admin, 'GET', `/api/dashboard?from=2000-01-01&to=${today}`)).body;
  const hisaab = (await api(admin, 'GET', '/api/hisaab')).body;
  const months = [...new Set([daysAgoYmd(3), daysAgoYmd(1), today].map(d => d.slice(0, 7)))];
  const earnings = {};
  for (const m of months) earnings[m] = (await api(admin, 'GET', `/api/earnings?month=${m}`)).body.revenue;
  const csv = (await api(admin, 'GET', '/api/export')).body;
  const customersCsv = (await api(admin, 'GET', '/api/customers?format=csv')).body;
  return { dash, hisaab, earnings, csv: parseCsv(csv), customers: parseCsv(customersCsv), drawer: drawer() };
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  return data.map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const sumCol = (rows, col) => r2(rows.reduce((s, r) => s + Number(r[col] || 0), 0));

// ---------------------------------------------------------------- the test
test(`money integrity under ${OPS} random operations (seed ${SEED})`, { timeout: 600000 }, async () => {
  const before = await reports();

  // Deterministic edge cases first, then the random mix.
  await opSale();
  await opSale({ backdated: true });
  ageBill();
  // An earlier day's bill edited today and then cancelled today (Hisaab edge case).
  {
    const aged = [...model.sales.values()].find(s => s.date === daysAgoYmd(1));
    if (aged) {
      const { body } = genSaleBody({ replaces_bill_id: aged.id });
      body.payments = [{ mode: 'cash', amount: body.payments.reduce((s, p) => s + p.amount, 0) }];
      const res = await api(admin, 'POST', '/api/bills', body);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      model.sales.delete(aged.id);
      recordSale(res.body, body, { backdated: false, date: aged.date, isEdit: true });
      model.drawer = r2(model.drawer + cashOf(body.payments) - aged.cash);
      const cancel = await api(admin, 'DELETE', `/api/bills/${res.body.bill_id}`);
      assert.equal(cancel.status, 200);
      model.sales.delete(res.body.bill_id);
      model.drawer = r2(model.drawer - cashOf(body.payments));
    }
  }

  const weights = [
    [opSale, 34], [() => opSale({ backdated: true }), 4], [opReturn, 22], [opCancelReturn, 6],
    [opCancelSale, 8], [opEditSale, 10], [opCashOut, 5], [async () => ageBill(), 3],
  ];
  const totalWeight = weights.reduce((s, [, w]) => s + w, 0);
  for (let i = 0; i < OPS; i++) {
    let x = rand() * totalWeight;
    const [op] = weights.find(([, w]) => (x -= w) < 0);
    await op();
  }

  const after = await reports();

  // ---- 1. Every bill in the database passes the money rules.
  const conn = openDb();
  const audit = auditDatabase(conn);
  conn.close();
  assert.deepEqual(audit.errors, [], 'money audit errors');
  assert.deepEqual(audit.warnings, [], 'money audit warnings');

  // ---- 2. The cash drawer moved by exactly the expected amount.
  near(r2(after.drawer - before.drawer), model.drawer, 'cash drawer change');

  // Expected totals for this test's live bills.
  const sales = [...model.sales.values()];
  const rets = [...model.returns.values()];
  const grossSales = r2(sales.reduce((s, x) => s + x.total, 0));
  const refunds = r2(rets.reduce((s, x) => s + x.total, 0));
  const net = r2(grossSales - refunds);
  const pieces = sales.reduce((s, x) => s + x.lines.reduce((a, l) => a + l.qty, 0), 0) - rets.reduce((s, x) => s + x.qty, 0);
  const modeTotal = (mode) => r2(
    sales.reduce((s, x) => s + x.payments.filter(p => p.mode === mode).reduce((a, p) => a + p.amount, 0), 0)
    - rets.filter(r => r.mode === mode).reduce((s, r) => s + r.total, 0));

  // ---- 3. Dashboard (all dates) agrees.
  const d0 = before.dash.summary, d1 = after.dash.summary;
  near(r2(d1.net_revenue - d0.net_revenue), net, 'Dashboard net revenue');
  near(r2(d1.gross_revenue - d0.gross_revenue), grossSales, 'Dashboard gross sales');
  near(r2(d1.total_returns - d0.total_returns), refunds, 'Dashboard returns');
  assert.equal(d1.total_bills - d0.total_bills, sales.length, 'Dashboard bill count (returns are not bills)');
  assert.equal(d1.total_items - d0.total_items, pieces, 'Dashboard pieces (net of returns)');
  for (const mode of ['cash', 'upi', 'card']) near(r2(d1[`${mode}_total`] - d0[`${mode}_total`]), modeTotal(mode), `Dashboard ${mode} total`);
  // Breakdowns add up to the same net revenue.
  near(r2(after.dash.categoryBreakdown.reduce((s, c) => s + c.revenue, 0)), r2(d1.net_revenue), 'category breakdown adds up', 0.05);
  near(r2(after.dash.salesmanBreakdown.reduce((s, c) => s + c.revenue, 0)), r2(d1.net_revenue), 'salesman breakdown adds up');

  // ---- 4. Earnings agrees month by month (by each bill's own date).
  for (const [month, e1] of Object.entries(after.earnings)) {
    const e0 = before.earnings[month];
    const inMonth = (d) => d.slice(0, 7) === month;
    const mSales = r2(sales.filter(s => inMonth(s.date)).reduce((a, s) => a + s.total, 0));
    const mRets = r2(rets.filter(r => inMonth(r.date)).reduce((a, r) => a + r.total, 0));
    near(r2(e1.total_sales - e0.total_sales), mSales, `Earnings ${month} sales`);
    near(r2(e1.total_returns - e0.total_returns), mRets, `Earnings ${month} returns`);
    near(r2(e1.net_revenue - e0.net_revenue), r2(mSales - mRets), `Earnings ${month} net`);
    assert.equal(e1.sale_count - e0.sale_count, sales.filter(s => inMonth(s.date)).length, `Earnings ${month} bill count`);
  }

  // ---- 5. CSV export: summing the Total column gives the true net, the same as the Dashboard.
  near(r2(sumCol(after.csv, 'Total') - sumCol(before.csv, 'Total')), net, 'CSV export net (sum of Total column)');
  near(sumCol(after.csv, 'Total'), r2(d1.net_revenue), 'CSV export total equals Dashboard net (all dates)', 0.05);
  assert.equal(after.csv.filter(r => r.Type === 'sale').length - before.csv.filter(r => r.Type === 'sale').length, sales.length, 'CSV sale rows');

  // ---- 6. Customers: total spend moved by exactly this test's customer bills.
  const custNet = r2(sales.filter(s => s.phone).reduce((a, s) => a + s.total, 0) - rets.filter(r => r.phone).reduce((a, r) => a + r.total, 0));
  near(r2(sumCol(after.customers, 'Spend') - sumCol(before.customers, 'Spend')), custNet, 'customer spend');

  // ---- 7. Hisaab's lines explain the drawer (no manual corrections in this test).
  const lines = (h) => r2(h.cash_in - h.cash_refunds + h.cash_adjustment - h.cash_out.total);
  near(r2(lines(after.hisaab) - lines(before.hisaab)), r2(model.drawer - model.agedCash), 'Hisaab lines vs drawer movement');
  near(r2(after.hisaab.cash_drawer - before.hisaab.cash_drawer), model.drawer, 'Hisaab drawer');

  console.log(`# integrity: ${sales.length} live sales, ${rets.length} live returns, net ₹${net}, drawer Δ ₹${model.drawer}`);
});
