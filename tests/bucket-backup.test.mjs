// Bucket backups: naming, retention, and a real upload through the AWS SDK to a
// small in-memory S3 stand-in (so nothing touches the real bucket).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import {
  keysFor, lockedQuarterKey, selectDeletions, isBackupDue, runBackup, backupStatus, bucketConfig,
} from '../src/lib/backup.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

// ---- in-memory S3 stand-in (path-style: /bucket/key)
const objects = new Map();
let failPuts = false;
let server, endpoint;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const [, bucket, ...rest] = url.pathname.split('/');
    const key = decodeURIComponent(rest.join('/'));
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'PUT') {
        if (failPuts) { res.writeHead(500); return res.end('<Error><Code>InternalError</Code></Error>'); }
        objects.set(key, Buffer.concat(chunks));
        res.writeHead(200, { ETag: '"x"' });
        return res.end();
      }
      if (req.method === 'HEAD') {
        if (!objects.has(key)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Length': objects.get(key).length, ETag: '"x"' });
        return res.end();
      }
      if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
      if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') || '';
        const keys = [...objects.keys()].filter(k => k.startsWith(prefix)).sort();
        const body = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucket}</Name><Prefix>${prefix}</Prefix><KeyCount>${keys.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${keys.map(k => `<Contents><Key>${k}</Key><Size>${objects.get(k).length}</Size></Contents>`).join('')}</ListBucketResult>`;
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        return res.end(body);
      }
      res.writeHead(400);
      res.end();
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const cfg = () => ({ endpoint, bucket: 'test-bucket', region: 'auto', accessKeyId: 'k', secretAccessKey: 's', forcePathStyle: true });

// A private copy of the test database (with the v14 backup-status columns).
async function tempDb() {
  const file = path.join(os.tmpdir(), `bucket-test-${Date.now()}-${Math.random()}.db`);
  const src = new Database(path.join(process.env.DATA_DIR, 'masterji_dev.db'), { readonly: true });
  await src.backup(file);
  src.close();
  return { db: new Database(file), file };
}

test('backup names: daily, monthly on the 1st, quarterly once a quarter has locked', () => {
  assert.deepEqual(keysFor('2026-09-28'), ['backups/daily/masterji-2026-09-28.db.gz']);
  assert.deepEqual(keysFor('2026-10-01'), ['backups/daily/masterji-2026-10-01.db.gz', 'backups/monthly/masterji-2026-10.db.gz']);
  assert.equal(lockedQuarterKey('2026-10-10'), 'backups/quarterly/masterji-FY26-27-Q1.db.gz', 'Jul–Sep not locked yet');
  assert.equal(lockedQuarterKey('2026-10-11'), 'backups/quarterly/masterji-FY26-27-Q2.db.gz');
  assert.equal(lockedQuarterKey('2027-04-11'), 'backups/quarterly/masterji-FY26-27-Q4.db.gz', 'Jan–Mar is Q4 of the previous FY');
});

test('retention: 30 days of dailies (never fewer than 7), monthlies 24 months, quarterlies forever', () => {
  const daily = (d) => `backups/daily/masterji-${d}.db.gz`;
  const days = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2026, 8, 28) - i * 86400e3).toISOString().slice(0, 10));
  const keys = [...days.map(daily), 'backups/monthly/masterji-2024-08.db.gz', 'backups/monthly/masterji-2024-09.db.gz',
    'backups/quarterly/masterji-FY20-21-Q1.db.gz'];
  const del = selectDeletions(keys, '2026-09-28');
  assert.ok(!del.includes(daily('2026-08-29')), '30 days kept');
  assert.ok(del.includes(daily('2026-08-28')));
  assert.ok(del.includes('backups/monthly/masterji-2024-08.db.gz'));
  assert.ok(!del.includes('backups/monthly/masterji-2024-09.db.gz'));
  assert.ok(!del.some(k => k.includes('quarterly')), 'quarterly never deleted');
  // After a long outage, the newest 7 dailies survive even if all are old.
  const old = Array.from({ length: 10 }, (_, i) => daily(`2026-01-${String(i + 1).padStart(2, '0')}`));
  assert.equal(selectDeletions(old, '2026-09-28').length, 3);
});

test('backup is due once a day after 11:30 pm IST, or at once if over a day late', () => {
  const at = (ist) => new Date(new Date(ist.replace(' ', 'T') + '+05:30'));
  const status = (last) => ({ enabled: true, last_backup_at: last });
  assert.equal(isBackupDue(status('2026-09-27 23:31:00'), at('2026-09-28 22:00:00')), false, 'before 11:30 pm');
  assert.equal(isBackupDue(status('2026-09-27 23:31:00'), at('2026-09-28 23:35:00')), true);
  assert.equal(isBackupDue(status('2026-09-28 23:31:00'), at('2026-09-28 23:50:00')), false, 'already done today');
  assert.equal(isBackupDue(status('2026-09-26 23:31:00'), at('2026-09-28 10:00:00')), true, 'over a day late');
  assert.equal(isBackupDue(status(null), at('2026-09-28 10:00:00')), true, 'never backed up');
  assert.equal(isBackupDue({ enabled: false }, at('2026-09-28 23:50:00')), false, 'off without a bucket');
  assert.equal(bucketConfig({}), null);
});

test('a backup uploads a restorable copy, keeps the right files, and cleans up old ones', async () => {
  objects.clear();
  for (let i = 1; i <= 40; i++) {
    const d = new Date(Date.UTC(2026, 9, 1) - i * 86400e3).toISOString().slice(0, 10);
    objects.set(`backups/daily/masterji-${d}.db.gz`, Buffer.from('old'));
  }
  objects.set('backups/monthly/masterji-2024-09.db.gz', Buffer.from('old'));
  const { db, file } = await tempDb();
  const now = new Date('2026-10-01T23:45:00+05:30');

  const result = await runBackup(db, { cfg: cfg(), now });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.uploaded, [
    'backups/daily/masterji-2026-10-01.db.gz',
    'backups/monthly/masterji-2026-10.db.gz',
    'backups/quarterly/masterji-FY26-27-Q1.db.gz',
  ]);

  // The uploaded file is a complete database with the same bills.
  const restored = path.join(os.tmpdir(), `restored-${Date.now()}.db`);
  fs.writeFileSync(restored, zlib.gunzipSync(objects.get('backups/daily/masterji-2026-10-01.db.gz')));
  const r = new Database(restored, { readonly: true });
  assert.equal(r.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(r.prepare('SELECT COUNT(*) n FROM bills').get().n, db.prepare('SELECT COUNT(*) n FROM bills').get().n);
  r.close();

  const dailies = [...objects.keys()].filter(k => k.startsWith('backups/daily/'));
  assert.equal(dailies.length, 31, 'new one + the 30 most recent days');
  assert.ok(!objects.has('backups/monthly/masterji-2024-09.db.gz'), 'monthly older than 24 months removed');
  const status = backupStatus(db, { cfg: cfg(), now });
  assert.equal(status.last_backup_key, 'backups/daily/masterji-2026-10-01.db.gz');
  assert.equal(status.last_error, null);
  assert.equal(status.stale, false);

  db.close();
  fs.rmSync(file, { force: true });
  fs.rmSync(restored, { force: true });
});

test('a failed upload deletes nothing and records the error', async () => {
  objects.clear();
  for (let i = 1; i <= 40; i++) {
    const d = new Date(Date.UTC(2026, 9, 1) - i * 86400e3).toISOString().slice(0, 10);
    objects.set(`backups/daily/masterji-${d}.db.gz`, Buffer.from('old'));
  }
  const { db, file } = await tempDb();
  failPuts = true;
  const result = await runBackup(db, { cfg: cfg(), now: new Date('2026-10-02T23:45:00+05:30') });
  failPuts = false;
  assert.equal(result.ok, false);
  assert.equal(objects.size, 40, 'no old copies were removed');
  const status = backupStatus(db, { cfg: cfg(), now: new Date('2026-10-02T23:45:00+05:30') });
  assert.ok(status.last_error);
  assert.equal(status.stale, true, 'no successful backup yet -> warning');
  db.close();
  fs.rmSync(file, { force: true });
});
