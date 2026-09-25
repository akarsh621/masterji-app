// Resets a LOCAL database to a fresh, seeded state.
//   npm run seed:dev -- --force   -> recreate data/masterji_dev.db
// The schema, migrations and seed data come from src/lib/db/index.js (the same
// code the app runs), so there is only one place that defines the database.
const path = require('path');
const fs = require('fs');

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

for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(DB_PATH + suffix)) fs.unlinkSync(DB_PATH + suffix);
}

process.env.DATA_DIR = DATA_DIR;
if (isDev) process.env.DB_MODE = 'dev';

import(path.join(__dirname, 'index.js')).then(({ getDb }) => {
  getDb();
  console.log(`\n${isDev ? 'DEV' : 'LOCAL'} database created at ${DB_PATH}`);
}).catch(err => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
