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
    cost_price REAL DEFAULT NULL CHECK(cost_price >= 0),
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
    petty_cash_target REAL NOT NULL DEFAULT 1000,
    schema_version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS print_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL REFERENCES bills(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'printing', 'printed', 'failed')),
    requested_by INTEGER NOT NULL REFERENCES users(id),
    printed_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);
CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL CHECK(category IN ('stock_purchase','salaries','shop_utilities','other')),
    amount REAL NOT NULL CHECK(amount > 0),
    label TEXT, note TEXT,
    expense_month TEXT NOT NULL, expense_date TEXT,
    recorded_by INTEGER NOT NULL REFERENCES users(id),
    created_at DATETIME DEFAULT (datetime('now','+5 hours','+30 minutes'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses(expense_month);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
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

const MIGRATIONS = [
  // v1: Add petty_cash_target to app_state
  (db) => {
    try { db.exec("ALTER TABLE app_state ADD COLUMN petty_cash_target REAL NOT NULL DEFAULT 1000"); } catch {}
  },
  // v2: Add sweep/manual to cash_out CHECK constraint (legacy, kept for version tracking)
  (db) => {
    const info = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cash_out'").get();
    if (info?.sql && !info.sql.includes("'sweep'")) {
      db.pragma('foreign_keys = OFF');
      db.exec(`CREATE TABLE cash_out_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount REAL NOT NULL CHECK(amount > 0),
        reason TEXT NOT NULL CHECK(reason IN ('expense','supplier','owner','other','sweep','manual')),
        note TEXT,
        recorded_by INTEGER NOT NULL REFERENCES users(id),
        created_at DATETIME DEFAULT (datetime('now','+5 hours','+30 minutes'))
      )`);
      db.exec('INSERT INTO cash_out_new SELECT * FROM cash_out');
      db.exec('DROP TABLE cash_out');
      db.exec('ALTER TABLE cash_out_new RENAME TO cash_out');
      db.exec('CREATE INDEX IF NOT EXISTS idx_cash_out_created_at ON cash_out(created_at)');
      db.pragma('foreign_keys = ON');
    }
  },
  // v3: Add cost_price to bill_items
  (db) => {
    try { db.exec("ALTER TABLE bill_items ADD COLUMN cost_price REAL DEFAULT NULL CHECK(cost_price >= 0)"); } catch {}
  },
  // v4: Add expenses table
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL CHECK(category IN ('stock_purchase','salaries','shop_utilities','other')),
      amount REAL NOT NULL CHECK(amount > 0),
      label TEXT, note TEXT,
      expense_month TEXT NOT NULL, expense_date TEXT,
      recorded_by INTEGER NOT NULL REFERENCES users(id),
      created_at DATETIME DEFAULT (datetime('now','+5 hours','+30 minutes'))
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses(expense_month)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category)");
  },
  // v5: Add mrp_total to bills and mrp to bill_items (missing on legacy prod DBs)
  (db) => {
    try { db.exec("ALTER TABLE bills ADD COLUMN mrp_total REAL DEFAULT 0"); } catch {}
    try { db.exec("ALTER TABLE bill_items ADD COLUMN mrp REAL CHECK(mrp > 0)"); } catch {}
    db.exec(`UPDATE bills SET mrp_total = (
      SELECT COALESCE(SUM(bi.mrp * bi.quantity), 0) FROM bill_items bi WHERE bi.bill_id = bills.id AND bi.mrp IS NOT NULL
    ) WHERE mrp_total = 0 OR mrp_total IS NULL`);
  },
  // v6: Add upi_accounts table for dynamic UPI QR generation
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS upi_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      upi_id TEXT NOT NULL,
      payee_name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now','+5 hours','+30 minutes'))
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_upi_accounts_active ON upi_accounts(active)");
  },
  // v7: Add audit columns to upi_accounts (created_by, updated_by, updated_at)
  (db) => {
    try { db.exec("ALTER TABLE upi_accounts ADD COLUMN created_by INTEGER REFERENCES users(id)"); } catch {}
    try { db.exec("ALTER TABLE upi_accounts ADD COLUMN updated_by INTEGER REFERENCES users(id)"); } catch {}
    try { db.exec("ALTER TABLE upi_accounts ADD COLUMN updated_at DATETIME"); } catch {}
  },
  // v8: Money integrity -- backdated flag, duplicate-request protection,
  // line-level return matching, and bill correction links.
  (db) => {
    addColumnIfMissing(db, 'bills', 'is_backdated', 'INTEGER NOT NULL DEFAULT 0');
    db.exec("UPDATE bills SET is_backdated = 1 WHERE notes LIKE '[Backdated]%'");

    addColumnIfMissing(db, 'bills', 'client_request_id', 'TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_client_request_id ON bills(client_request_id)');
    addColumnIfMissing(db, 'cash_out', 'client_request_id', 'TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_out_client_request_id ON cash_out(client_request_id)');

    addColumnIfMissing(db, 'bills', 'replaces_bill_id', 'INTEGER REFERENCES bills(id)');

    addColumnIfMissing(db, 'bill_items', 'orig_bill_item_id', 'INTEGER REFERENCES bill_items(id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_bill_items_orig ON bill_items(orig_bill_item_id)');
    backfillReturnLineLinks(db);
  },
  // v9: Failed login attempts, for brute-force protection on the public URL.
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL,
      ip TEXT NOT NULL,
      at INTEGER NOT NULL
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_login_attempts_account ON login_attempts(account, at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, at)');
  },
  // v10: UPI QR generation removed (payments are verified on the POS machines).
  // UPI as a payment mode is unaffected; only the VPA list goes.
  (db) => {
    db.exec('DROP TABLE IF EXISTS upi_accounts');
  },
  // v11: Optional customer on bills. A phone number is a household (family
  // members share one), so bills also keep the name as typed on that bill.
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL UNIQUE,
      name TEXT,
      first_seen_at DATETIME,
      last_seen_at DATETIME,
      created_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
    )`);
    addColumnIfMissing(db, 'bills', 'customer_id', 'INTEGER REFERENCES customers(id)');
    addColumnIfMissing(db, 'bills', 'customer_name', 'TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_bills_customer_id ON bills(customer_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_bills_total ON bills(total)');
  },
];

function addColumnIfMissing(db, table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Existing return lines were matched to the sale by category only. Link each
// to a concrete sale line (same category, with quantity still unreturned), so
// quantities already refunded keep counting against what can be returned.
function backfillReturnLineLinks(db) {
  const returnLines = db.prepare(`
    SELECT ri.id, ri.category_id, ri.quantity, rb.original_bill_id
    FROM bill_items ri
    JOIN bills rb ON rb.id = ri.bill_id
    WHERE rb.type = 'return' AND rb.original_bill_id IS NOT NULL AND ri.orig_bill_item_id IS NULL
    ORDER BY ri.id
  `).all();
  const saleLines = db.prepare('SELECT id, category_id, quantity FROM bill_items WHERE bill_id = ? ORDER BY id');
  const link = db.prepare('UPDATE bill_items SET orig_bill_item_id = ? WHERE id = ?');
  const remainingByBill = new Map();

  for (const r of returnLines) {
    if (!remainingByBill.has(r.original_bill_id)) {
      remainingByBill.set(r.original_bill_id, saleLines.all(r.original_bill_id).map(l => ({ ...l, left: l.quantity })));
    }
    const lines = remainingByBill.get(r.original_bill_id).filter(l => l.category_id === r.category_id);
    const target = lines.find(l => l.left >= r.quantity) || lines.find(l => l.left > 0) || lines[0];
    if (!target) continue;
    target.left -= r.quantity;
    link.run(target.id, r.id);
  }
}

function runMigrations(db) {
  try { db.exec("ALTER TABLE app_state ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 0"); } catch {}

  let current = 0;
  try {
    const row = db.prepare('SELECT schema_version FROM app_state WHERE id = 1').get();
    current = row?.schema_version ?? 0;
  } catch { /* column doesn't exist yet on first run before app_state row exists */ }

  if (current >= MIGRATIONS.length) return;

  for (let i = current; i < MIGRATIONS.length; i++) {
    console.log(`Running migration v${i + 1}...`);
    db.transaction(() => {
      MIGRATIONS[i](db);
      db.prepare('UPDATE app_state SET schema_version = ? WHERE id = 1').run(i + 1);
    })();
    console.log(`Migration v${i + 1} complete.`);
  }
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production' && process.env.DB_MODE !== 'dev';

function autoSeed(db) {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count > 0) return;

  const insertUser = db.prepare(
    'INSERT INTO users (name, role, username, password_hash, pin) VALUES (?, ?, ?, ?, ?)'
  );

  if (IS_PRODUCTION) {
    // An empty users table in production almost always means the Railway volume
    // is missing or DATA_DIR is wrong. Refuse to start rather than quietly
    // creating a fresh database with a known password on the public URL.
    const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;
    if (!initialPassword || initialPassword.length < 8) {
      throw new Error(
        `Production database at ${DB_PATH} has no users. Check that the volume is mounted and DATA_DIR is set. ` +
        'For a genuinely new install, set ADMIN_INITIAL_PASSWORD (8+ characters) for the first start only.'
      );
    }
    console.log('New production database -- creating admin from ADMIN_INITIAL_PASSWORD...');
    insertUser.run('Admin', 'admin', 'admin', bcrypt.hashSync(initialPassword, 10), null);
  } else {
    console.log('Empty dev database detected -- auto-seeding default data...');
    insertUser.run('Admin', 'admin', 'admin', bcrypt.hashSync('admin123', 10), null);
    insertUser.run('Salesman 1', 'salesman', null, null, '1111');
    insertUser.run('Salesman 2', 'salesman', null, null, '2222');
    insertUser.run('Salesman 3', 'salesman', null, null, '3333');
  }

  const insertCategory = db.prepare(
    'INSERT INTO categories (name, group_name, display_order) VALUES (?, ?, ?)'
  );
  const seedAll = db.transaction(() => {
    for (const [name, group, order] of DEFAULT_CATEGORIES) {
      insertCategory.run(name, group, order);
    }
  });
  const categoryCount = db.prepare('SELECT COUNT(*) as count FROM categories').get();
  if (categoryCount.count === 0) seedAll();

  console.log(IS_PRODUCTION ? 'Initial admin created.' : 'Dev auto-seed complete: admin/admin123, PINs: 1111, 2222, 3333');
}

let db;

export function getDb() {
  if (db) return db;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const conn = new Database(DB_PATH);
  try {
    conn.pragma('journal_mode = WAL');
    conn.pragma('foreign_keys = ON');

    conn.exec(SCHEMA_SQL);
    conn.exec("INSERT OR IGNORE INTO app_state (id, cash_drawer) VALUES (1, 0)");
    runMigrations(conn);

    autoSeed(conn);
  } catch (err) {
    conn.close();
    throw err;
  }

  // Only cache once startup fully succeeded, so a failed start is retried
  // (and keeps failing loudly) instead of handing out a half-initialised DB.
  db = conn;
  // Closing checkpoints the WAL into the main file, so a redeploy leaves a
  // single self-contained masterji.db on the volume.
  process.once('exit', () => { try { db.close(); } catch {} });
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
  // Rounded on every write so float drift (0.1 + 0.2 != 0.3) can never accumulate.
  db.prepare('UPDATE app_state SET cash_drawer = ROUND(cash_drawer + ?, 2) WHERE id = 1').run(delta);
}

export function setCashDrawer(db, amount) {
  db.prepare('UPDATE app_state SET cash_drawer = ROUND(?, 2) WHERE id = 1').run(amount);
}

export function getPettyCashTarget(db) {
  const row = db.prepare('SELECT petty_cash_target FROM app_state WHERE id = 1').get();
  return row?.petty_cash_target ?? 1000;
}

export function setPettyCashTarget(db, amount) {
  db.prepare('UPDATE app_state SET petty_cash_target = ? WHERE id = 1').run(amount);
}
