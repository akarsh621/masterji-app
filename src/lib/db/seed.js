const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const isDev = process.argv.includes('--dev');
const force = process.argv.includes('--force');
const DB_FILE = isDev ? 'masterji_dev.db' : 'masterji.db';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, DB_FILE);

// This script DELETES the database. Never allow it on Railway, and never let
// it wipe an existing file without an explicit --force.
if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME) {
  console.error('Refusing to run: seed.js deletes the database and must never run on Railway.');
  process.exit(1);
}
if (!isDev && !force) {
  console.error('Refusing to reseed the PROD database file. Use `npm run seed:dev` for the dev database.');
  process.exit(1);
}
if (fs.existsSync(DB_PATH) && !force) {
  console.error(`${DB_PATH} already exists. Re-run with --force to delete it and start fresh.`);
  process.exit(1);
}

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(DB_PATH + suffix)) {
    fs.unlinkSync(DB_PATH + suffix);
  }
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schema);

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

const categories = [
  ['Kurti', 'women', 1],
  ['Top', 'women', 2],
  ['Palazzo/Pant', 'women', 3],
  ['Dupatta', 'women', 4],
  ['Dress', 'women', 5],
  ['Saree', 'women', 6],
  ['Legging', 'women', 7],
  ['Boys T-shirt', 'kids', 8],
  ['Boys Pant', 'kids', 9],
  ['Girls Top', 'kids', 10],
  ['Girls Dress', 'kids', 11],
  ['Girls Legging', 'kids', 12],
  ['Shirt', 'men', 13],
  ['T-shirt', 'men', 14],
  ['Pant', 'men', 15],
  ['Jeans', 'men', 16],
  ['Other', 'other', 99],
];

const insertMany = db.transaction(() => {
  for (const [name, group, order] of categories) {
    insertCategory.run(name, group, order);
  }
});
insertMany();

console.log(`\n${isDev ? '🔧 DEV' : '🏪 PROD'} database seeded successfully!`);
console.log(`DB location: ${DB_PATH}`);
console.log('Admin login: username=admin, password=admin123');
console.log('Salesman PINs: 1111, 2222, 3333');
console.log(`Categories: ${categories.length} (including "Other" custom category)`);

db.close();
