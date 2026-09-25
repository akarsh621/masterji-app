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

-- Single-row table holding persistent app state
CREATE TABLE IF NOT EXISTS app_state (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    cash_drawer REAL NOT NULL DEFAULT 0,
    petty_cash_target REAL NOT NULL DEFAULT 1000
);
INSERT OR IGNORE INTO app_state (id, cash_drawer, petty_cash_target) VALUES (1, 0, 1000);

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

CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL CHECK(category IN ('stock_purchase', 'salaries', 'shop_utilities', 'other')),
    amount REAL NOT NULL CHECK(amount > 0),
    label TEXT,
    note TEXT,
    expense_month TEXT NOT NULL,
    expense_date TEXT,
    recorded_by INTEGER NOT NULL REFERENCES users(id),
    created_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
);

CREATE INDEX IF NOT EXISTS idx_expenses_month ON expenses(expense_month);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);

CREATE INDEX IF NOT EXISTS idx_bills_created_at ON bills(created_at);
CREATE INDEX IF NOT EXISTS idx_bills_salesman_id ON bills(salesman_id);
CREATE INDEX IF NOT EXISTS idx_bills_payment_mode ON bills(payment_mode);
CREATE INDEX IF NOT EXISTS idx_bills_deleted_at ON bills(deleted_at);
CREATE INDEX IF NOT EXISTS idx_bills_type ON bills(type);
CREATE INDEX IF NOT EXISTS idx_bill_items_bill_id ON bill_items(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_items_category_id ON bill_items(category_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_bill_id ON bill_payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_cash_out_created_at ON cash_out(created_at);
