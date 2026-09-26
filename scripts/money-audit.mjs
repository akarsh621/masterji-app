// Money audit: checks every bill in a Master Ji database against the money
// rules, and prints turnover by month and by GST quarter.
//
//   node scripts/money-audit.mjs <path-to-db-file>
//
// Opens the file READ-ONLY. Run it on a copy of the production database
// (download via /api/backup), never needs the app to be running.
// Exit code 1 if any ERROR is found.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const EPS = 0.011; // money compared to the paisa (with float slack)
const r2 = (v) => Math.round((v || 0) * 100) / 100;
const differs = (a, b) => Math.abs((a || 0) - (b || 0)) > EPS;

// Returns { errors: [..], warnings: [..], stats } for an open better-sqlite3 db.
export function auditDatabase(db) {
  const errors = [];
  const warnings = [];
  const err = (bill, msg) => errors.push(`${bill.bill_number}: ${msg}`);
  const warn = (bill, msg) => warnings.push(`${bill.bill_number}: ${msg}`);

  const bills = db.prepare('SELECT * FROM bills ORDER BY id').all();
  const byId = new Map(bills.map(b => [b.id, b]));
  const itemsByBill = new Map();
  for (const it of db.prepare('SELECT * FROM bill_items ORDER BY id').all()) {
    if (!itemsByBill.has(it.bill_id)) itemsByBill.set(it.bill_id, []);
    itemsByBill.get(it.bill_id).push(it);
  }
  const payByBill = new Map();
  for (const p of db.prepare('SELECT * FROM bill_payments ORDER BY id').all()) {
    if (!payByBill.has(p.bill_id)) payByBill.set(p.bill_id, []);
    payByBill.get(p.bill_id).push(p);
  }
  const lineById = new Map();
  for (const list of itemsByBill.values()) for (const it of list) lineById.set(it.id, it);

  // ---- Every bill (active or cancelled): its own numbers must be consistent.
  for (const b of bills) {
    const items = itemsByBill.get(b.id) || [];
    const pays = payByBill.get(b.id) || [];
    if (items.length === 0) err(b, 'has no items');
    if (pays.length === 0) err(b, 'has no payments');
    if (!(b.total > 0)) err(b, `total ${b.total} is not positive`);

    const itemSum = r2(items.reduce((s, i) => s + i.amount, 0));
    if (differs(b.subtotal, itemSum)) err(b, `subtotal ${b.subtotal} != sum of items ${itemSum}`);
    if (differs(b.total, r2(b.subtotal - (b.discount_amount || 0)))) {
      err(b, `total ${b.total} != subtotal ${b.subtotal} - discount ${b.discount_amount}`);
    }
    if ((b.discount_amount || 0) < -EPS) err(b, `negative discount ${b.discount_amount}`);

    const paySum = r2(pays.reduce((s, p) => s + p.amount, 0));
    if (differs(paySum, b.total)) err(b, `payments ${paySum} != total ${b.total}`);
    for (const p of pays) {
      if (!['cash', 'upi', 'card'].includes(p.mode)) err(b, `payment mode "${p.mode}" not allowed`);
      if (!(p.amount > 0)) err(b, `payment amount ${p.amount} not positive`);
    }
    const modes = [...new Set(pays.map(p => p.mode))];
    const expectedMode = modes.length === 1 ? modes[0] : 'mixed';
    if (pays.length && b.payment_mode !== expectedMode) err(b, `payment_mode ${b.payment_mode} but payments say ${expectedMode}`);

    for (const it of items) {
      if (!(it.quantity > 0)) err(b, `item ${it.id} quantity ${it.quantity}`);
      if (!(it.amount > 0)) err(b, `item ${it.id} amount ${it.amount}`);
      if (b.type === 'sale' && it.mrp && it.amount > it.mrp * it.quantity + EPS) {
        err(b, `item ${it.id} sold above MRP (${it.amount} > ${it.mrp} x ${it.quantity})`);
      }
    }

    if (b.type === 'return') {
      if (differs(b.subtotal, b.total) || (b.discount_amount || 0) > EPS) warn(b, 'return has a discount (unexpected)');
      if (pays.some(p => p.mode === 'card')) warn(b, 'refund recorded as Card (not allowed since Project 1)');
    }
  }

  // ---- Returns: never more than was sold or paid, and tied to a real sale.
  const activeReturns = bills.filter(b => b.type === 'return' && !b.deleted_at);
  const refundedByOriginal = new Map();
  const returnedQtyByLine = new Map();
  for (const r of activeReturns) {
    const orig = byId.get(r.original_bill_id);
    if (!orig) { err(r, 'return points to a missing original bill'); continue; }
    if (orig.type !== 'sale') err(r, `return points to ${orig.bill_number}, which is not a sale`);
    if (orig.deleted_at) err(r, `active return against cancelled bill ${orig.bill_number}`);
    if (orig.salesman_id !== r.salesman_id) warn(r, `credited to a different salesman than ${orig.bill_number}`);
    refundedByOriginal.set(orig.id, r2((refundedByOriginal.get(orig.id) || 0) + r.total));
    for (const it of itemsByBill.get(r.id) || []) {
      if (it.orig_bill_item_id == null) { warn(r, `return line ${it.id} not linked to a sale line`); continue; }
      const line = lineById.get(it.orig_bill_item_id);
      if (!line || line.bill_id !== orig.id) { err(r, `return line ${it.id} links to a line outside ${orig.bill_number}`); continue; }
      returnedQtyByLine.set(line.id, (returnedQtyByLine.get(line.id) || 0) + it.quantity);
    }
  }
  for (const [origId, refunded] of refundedByOriginal) {
    const orig = byId.get(origId);
    if (refunded > orig.total + EPS) err(orig, `refunded ${refunded} > paid ${orig.total}`);
  }
  for (const [lineId, qty] of returnedQtyByLine) {
    const line = lineById.get(lineId);
    if (qty > line.quantity) err(byId.get(line.bill_id), `line ${lineId}: returned ${qty} of ${line.quantity} pieces`);
  }

  // ---- Edits (cancel + reissue): the old bill must be cancelled, the new one keeps its date.
  for (const b of bills.filter(x => x.replaces_bill_id)) {
    const old = byId.get(b.replaces_bill_id);
    if (!old) { err(b, 'replaces a missing bill'); continue; }
    if (!old.deleted_at) err(b, `replaces ${old.bill_number}, which is still active (counted twice)`);
    if (old.created_at !== b.created_at) err(b, `date ${b.created_at} differs from the bill it replaced (${old.created_at})`);
    if (!!old.is_backdated !== !!b.is_backdated) err(b, 'backdated flag differs from the bill it replaced');
  }

  // ---- Turnover: active sales minus active returns, by the bill's date.
  const period = new Map();
  const add = (key, b) => {
    const p = period.get(key) || { sales: 0, returns: 0, saleCount: 0, returnCount: 0 };
    if (b.type === 'sale') { p.sales = r2(p.sales + b.total); p.saleCount++; }
    else { p.returns = r2(p.returns + b.total); p.returnCount++; }
    period.set(key, p);
  };
  for (const b of bills.filter(x => !x.deleted_at)) {
    add(b.created_at.slice(0, 7), b);
    add(gstQuarter(b.created_at.slice(0, 10)), b);
  }
  const totals = [...period.entries()].sort().map(([key, p]) => ({ key, ...p, net: r2(p.sales - p.returns) }));

  return { errors, warnings, totals, billCount: bills.length };
}

// Financial-year quarter label, e.g. 2026-09-15 -> "FY26-27 Q2 (Jul-Sep)".
export function gstQuarter(ymd) {
  const [y, m] = ymd.split('-').map(Number);
  const fyStart = m >= 4 ? y : y - 1;
  const q = m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4;
  const names = ['Apr-Jun', 'Jul-Sep', 'Oct-Dec', 'Jan-Mar'];
  return `FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)} Q${q} (${names[q - 1]})`;
}

// ---- CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/money-audit.mjs <path-to-db-file>');
    process.exit(2);
  }
  const Database = require('better-sqlite3');
  const db = new Database(file, { readonly: true, fileMustExist: true });
  const { errors, warnings, totals, billCount } = auditDatabase(db);
  db.close();

  const inr = (n) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  console.log(`Checked ${billCount} bills in ${file}\n`);
  console.log('Turnover (active sales − active returns, by bill date)');
  console.log('Period'.padEnd(26) + 'Sales'.padStart(16) + 'Returns'.padStart(14) + 'Net'.padStart(16) + '  Bills');
  for (const t of totals) {
    console.log(t.key.padEnd(26) + inr(t.sales).padStart(16) + inr(t.returns).padStart(14) + inr(t.net).padStart(16) + `  ${t.saleCount} sale / ${t.returnCount} return`);
  }
  console.log(`\nWarnings: ${warnings.length}`);
  for (const w of warnings) console.log('  - ' + w);
  console.log(`Errors: ${errors.length}`);
  for (const e of errors) console.log('  ✗ ' + e);
  console.log(errors.length ? '\nFAILED: fix the errors above before relying on these figures.' : '\nOK: every bill passes the money checks.');
  process.exit(errors.length ? 1 : 0);
}
