import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';

const DB_FILE = process.env.DB_MODE === 'dev' ? 'masterji_dev.db' : 'masterji.db';
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, DB_FILE);

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'salesman')),
    username TEXT UNIQUE,
    password_hash TEXT,
    pin TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    group_name TEXT NOT NULL CHECK(group_name IN ('women', 'men', 'kids', 'other')),
    active INTEGER DEFAULT 1,
    display_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);
CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_number TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'sale' CHECK(type IN ('sale', 'return')),
    original_bill_id INTEGER REFERENCES bills(id),
    subtotal REAL NOT NULL CHECK(subtotal >= 0),
    mrp_total REAL DEFAULT 0,
    discount_percent REAL DEFAULT 0 CHECK(discount_percent >= 0 AND discount_percent <= 100),
    discount_amount REAL DEFAULT 0 CHECK(discount_amount >= 0),
    total REAL NOT NULL CHECK(total > 0),
    payment_mode TEXT NOT NULL CHECK(payment_mode IN ('cash', 'upi', 'card', 'mixed')),
    salesman_id INTEGER NOT NULL REFERENCES users(id),
    notes TEXT,
    deleted_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);
CREATE TABLE IF NOT EXISTS bill_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    mrp REAL CHECK(mrp > 0),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    amount REAL NOT NULL CHECK(amount > 0),
    created_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);
CREATE TABLE IF NOT EXISTS bill_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK(mode IN ('cash', 'upi', 'card')),
    amount REAL NOT NULL CHECK(amount > 0),
    created_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);
CREATE TABLE IF NOT EXISTS cash_out (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL CHECK(amount > 0),
    reason TEXT NOT NULL CHECK(reason IN ('expense', 'supplier', 'owner', 'other', 'sweep', 'manual')),
    note TEXT,
    recorded_by INTEGER NOT NULL REFERENCES users(id),
    created_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);
CREATE TABLE IF NOT EXISTS app_state (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    cash_drawer REAL NOT NULL DEFAULT 0,
    petty_cash_target REAL NOT NULL DEFAULT 1000
);
CREATE TABLE IF NOT EXISTS print_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL REFERENCES bills(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'printing', 'printed', 'failed')),
    requested_by INTEGER NOT NULL REFERENCES users(id),
    printed_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);
CREATE INDEX IF NOT EXISTS idx_print_queue_status ON print_queue(status);
CREATE INDEX IF NOT EXISTS idx_print_queue_bill_id ON print_queue(bill_id);
CREATE INDEX IF NOT EXISTS idx_bills_created_at ON bills(created_at);
CREATE INDEX IF NOT EXISTS idx_bills_salesman_id ON bills(salesman_id);
CREATE INDEX IF NOT EXISTS idx_bills_payment_mode ON bills(payment_mode);
CREATE INDEX IF NOT EXISTS idx_bills_deleted_at ON bills(deleted_at);
CREATE INDEX IF NOT EXISTS idx_bills_type ON bills(type);
CREATE INDEX IF NOT EXISTS idx_bill_items_bill_id ON bill_items(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_items_category_id ON bill_items(category_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_bill_id ON bill_payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_cash_out_created_at ON cash_out(created_at);
`;

const DEFAULT_CATEGORIES = [
  ['Kurti', 'women', 1], ['Top', 'women', 2], ['Palazzo/Pant', 'women', 3],
  ['Dupatta', 'women', 4], ['Dress', 'women', 5], ['Saree', 'women', 6],
  ['Legging', 'women', 7], ['Boys T-shirt', 'kids', 8], ['Boys Pant', 'kids', 9],
  ['Girls Top', 'kids', 10], ['Girls Dress', 'kids', 11], ['Girls Legging', 'kids', 12],
  ['Shirt', 'men', 13], ['T-shirt', 'men', 14], ['Pant', 'men', 15],
  ['Jeans', 'men', 16], ['Other', 'other', 99],
];

function autoSeed(db) {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count > 0) return;

  console.log('Empty database detected -- auto-seeding default data...');

  const adminPassword = bcrypt.hashSync('admin123', 10);
  const insertUser = db.prepare(
    'INSERT INTO users (name, role, username, password_hash, pin) VALUES (?, ?, ?, ?, ?)'
  );
  insertUser.run('Admin', 'admin', 'admin', adminPassword, null);
  insertUser.run('Salesman 1', 'salesman', null, null, '1111');
  insertUser.run('Salesman 2', 'salesman', null, null, '2222');
  insertUser.run('Salesman 3', 'salesman', null, null, '3333');

  const insertCategory = db.prepare(
    'INSERT INTO categories (name, group_name, display_order) VALUES (?, ?, ?)'
  );
  const seedAll = db.transaction(() => {
    for (const [name, group, order] of DEFAULT_CATEGORIES) {
      insertCategory.run(name, group, order);
    }
  });
  seedAll();

  console.log('Auto-seed complete: admin/admin123, PINs: 1111, 2222, 3333');
}

let db;

export function getDb() {
  if (db) return db;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(SCHEMA_SQL);

  // Safe migration for existing DBs that predate petty_cash_target
  try { db.exec("ALTER TABLE app_state ADD COLUMN petty_cash_target REAL NOT NULL DEFAULT 1000"); } catch {}

  // Migrate cash_out CHECK constraint to include 'sweep' and 'manual'
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cash_out'").get();
    if (tableInfo && tableInfo.sql && !tableInfo.sql.includes("'sweep'")) {
      console.log('Migrating cash_out table to add sweep/manual reasons...');
      db.pragma('foreign_keys = OFF');
      db.transaction(() => {
        db.exec(`CREATE TABLE cash_out_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          amount REAL NOT NULL CHECK(amount > 0),
          reason TEXT NOT NULL CHECK(reason IN ('expense', 'supplier', 'owner', 'other', 'sweep', 'manual')),
          note TEXT,
          recorded_by INTEGER NOT NULL REFERENCES users(id),
          created_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
        )`);
        db.exec('INSERT INTO cash_out_new SELECT * FROM cash_out');
        db.exec('DROP TABLE cash_out');
        db.exec('ALTER TABLE cash_out_new RENAME TO cash_out');
        db.exec('CREATE INDEX IF NOT EXISTS idx_cash_out_created_at ON cash_out(created_at)');
      })();
      db.pragma('foreign_keys = ON');
      console.log('cash_out migration complete.');
    }
  } catch (err) {
    console.error('cash_out migration error (non-fatal):', err.message);
  }

  db.exec("INSERT OR IGNORE INTO app_state (id, cash_drawer, petty_cash_target) VALUES (1, 0, 1000)");

  autoSeed(db);

  return db;
}

export function generateBillNumber() {
  const db = getDb();
  const row = db.prepare("SELECT MAX(id) as max_id FROM bills").get();
  const nextId = (row?.max_id || 0) + 1;
  return `MJF-${String(nextId).padStart(4, '0')}`;
}

export function getISTNow() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().replace('T', ' ').substring(0, 19);
}

export function getCashDrawer(db) {
  const row = db.prepare('SELECT cash_drawer FROM app_state WHERE id = 1').get();
  return row?.cash_drawer ?? 0;
}

export function updateCashDrawer(db, delta) {
  db.prepare('UPDATE app_state SET cash_drawer = cash_drawer + ? WHERE id = 1').run(delta);
}

export function setCashDrawer(db, amount) {
  db.prepare('UPDATE app_state SET cash_drawer = ? WHERE id = 1').run(amount);
}

export function getPettyCashTarget(db) {
  try {
    const row = db.prepare('SELECT petty_cash_target FROM app_state WHERE id = 1').get();
    return row?.petty_cash_target ?? 1000;
  } catch {
    return 1000;
  }
}

export function setPettyCashTarget(db, amount) {
  db.prepare('UPDATE app_state SET petty_cash_target = ? WHERE id = 1').run(amount);
}
