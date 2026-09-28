// Automatic database backups to the Railway bucket (S3-compatible).
//
//   backups/daily/masterji-YYYY-MM-DD.db.gz     last 30 days (always at least the newest 7)
//   backups/monthly/masterji-YYYY-MM.db.gz      the 1st of each month, kept 24 months
//   backups/quarterly/masterji-FY26-27-Q2.db.gz each GST quarter, taken once it locks
//                                                (the 11th after it ends), kept forever
//
// Runs once a day at 11:30 pm IST (see src/instrumentation.js) and on demand
// ("Backup now" in Settings). Cleanup only runs after a successful, verified
// upload, so a failing day never deletes older copies.
//
// Configured by the bucket variables Railway provides: BUCKET_ENDPOINT,
// BUCKET_NAME, BUCKET_REGION, BUCKET_ACCESS_KEY, BUCKET_SECRET_KEY. Without
// them (local dev, tests) backups to the bucket are off.
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import Database from 'better-sqlite3';
import {
  S3Client, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { previousQuarter, quarterLockDate } from './date-utils.js';

export const DAILY_KEEP_DAYS = 30;
export const DAILY_KEEP_MIN = 7;
export const MONTHLY_KEEP_MONTHS = 24;
export const BACKUP_TIME_IST = '23:30';
export const STALE_AFTER_HOURS = 36;

export function bucketConfig(env = process.env) {
  const { BUCKET_ENDPOINT, BUCKET_NAME, BUCKET_REGION, BUCKET_ACCESS_KEY, BUCKET_SECRET_KEY } = env;
  if (!BUCKET_ENDPOINT || !BUCKET_NAME || !BUCKET_ACCESS_KEY || !BUCKET_SECRET_KEY) return null;
  return {
    endpoint: /^https?:\/\//.test(BUCKET_ENDPOINT) ? BUCKET_ENDPOINT : `https://${BUCKET_ENDPOINT}`,
    bucket: BUCKET_NAME,
    region: BUCKET_REGION || 'auto',
    accessKeyId: BUCKET_ACCESS_KEY,
    secretAccessKey: BUCKET_SECRET_KEY,
    forcePathStyle: env.BUCKET_FORCE_PATH_STYLE === 'true',
  };
}

function client(cfg) {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    forcePathStyle: cfg.forcePathStyle,
    // S3-compatible stores don't all accept the newer default checksums.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

// IST wall-clock parts for `now`.
export function istParts(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600e3).toISOString();
  return { date: ist.slice(0, 10), time: ist.slice(11, 16), stamp: ist.slice(0, 19).replace('T', ' ') };
}

// Consistent, self-contained snapshot (no -wal/-shm needed), gzipped.
export async function snapshotGz(db) {
  const tmp = path.join(os.tmpdir(), `masterji-snapshot-${process.pid}-${Date.now()}.db`);
  try {
    await db.backup(tmp);
    const copy = new Database(tmp);
    copy.pragma('journal_mode = DELETE');
    copy.close();
    return zlib.gzipSync(fs.readFileSync(tmp));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// Keys to upload for a backup taken on `date` (IST YYYY-MM-DD).
export function keysFor(date) {
  const keys = [`backups/daily/masterji-${date}.db.gz`];
  if (date.endsWith('-01')) keys.push(`backups/monthly/masterji-${date.slice(0, 7)}.db.gz`);
  return keys;
}

// The quarter that should have a permanent copy by `date`: the most recent
// quarter whose lock date (11th of the month after it ends) has arrived.
export function lockedQuarterKey(date) {
  let q = previousQuarter(date);
  if (date < quarterLockDate(q.from)) q = previousQuarter(q.from);
  const [, startYear, endYY] = q.fyLabel.match(/^FY (\d{4})-(\d{2})$/); // "FY 2026-27"
  return `backups/quarterly/masterji-FY${startYear.slice(2)}-${endYY}-Q${q.q}.db.gz`;
}

// Which existing keys retention removes, given today's IST date. Pure, for tests.
export function selectDeletions(keys, today) {
  const toDelete = [];
  const daily = keys
    .map(k => ({ k, d: k.match(/^backups\/daily\/masterji-(\d{4}-\d{2}-\d{2})\.db\.gz$/)?.[1] }))
    .filter(x => x.d)
    .sort((a, b) => b.d.localeCompare(a.d));
  const cutoff = new Date(new Date(today + 'T00:00:00Z').getTime() - DAILY_KEEP_DAYS * 86400e3).toISOString().slice(0, 10);
  daily.forEach((x, i) => {
    if (i >= DAILY_KEEP_MIN && x.d < cutoff) toDelete.push(x.k);
  });

  const [ty, tm] = today.split('-').map(Number);
  const monthIndex = ty * 12 + (tm - 1);
  for (const k of keys) {
    const m = k.match(/^backups\/monthly\/masterji-(\d{4})-(\d{2})\.db\.gz$/);
    if (m && monthIndex - (Number(m[1]) * 12 + Number(m[2]) - 1) > MONTHLY_KEEP_MONTHS) toDelete.push(k);
  }
  // Quarterly copies are never deleted.
  return toDelete;
}

async function listKeys(s3, bucket) {
  const keys = [];
  let ContinuationToken;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'backups/', ContinuationToken }));
    for (const o of res.Contents || []) keys.push(o.Key);
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

async function exists(s3, bucket, key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return false;
    throw err;
  }
}

async function putVerified(s3, bucket, key, body) {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'application/gzip' }));
  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  if (Number(head.ContentLength) !== body.length) {
    throw new Error(`upload check failed for ${key}: ${head.ContentLength} bytes in bucket, expected ${body.length}`);
  }
}

let running = null;

// Takes and uploads a backup, then applies retention. Records the outcome in
// app_state. Never throws; returns { ok, key?, deleted?, error? }.
export function runBackup(db, { cfg = bucketConfig(), now = new Date() } = {}) {
  if (running) return running;
  running = (async () => {
    const { date, stamp } = istParts(now);
    db.prepare('UPDATE app_state SET last_backup_attempt_at = ? WHERE id = 1').run(stamp);
    try {
      if (!cfg) throw new Error('Bucket set nahi hai (BUCKET_* variables missing)');
      const s3 = client(cfg);
      const body = await snapshotGz(db);

      const keys = keysFor(date);
      for (const key of keys) await putVerified(s3, cfg.bucket, key, body);

      const quarterly = lockedQuarterKey(date);
      if (!(await exists(s3, cfg.bucket, quarterly))) {
        await putVerified(s3, cfg.bucket, quarterly, body);
        keys.push(quarterly);
      }

      // Only after every upload above succeeded.
      const deleted = selectDeletions(await listKeys(s3, cfg.bucket), date);
      for (const key of deleted) await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));

      db.prepare('UPDATE app_state SET last_backup_at = ?, last_backup_key = ?, last_backup_error = NULL WHERE id = 1')
        .run(stamp, keys[0]);
      return { ok: true, key: keys[0], uploaded: keys, deleted };
    } catch (err) {
      const message = String(err?.message || err).slice(0, 300);
      console.error('[backup] failed:', message);
      db.prepare('UPDATE app_state SET last_backup_error = ? WHERE id = 1').run(message);
      return { ok: false, error: message };
    } finally {
      running = null;
    }
  })();
  return running;
}

export function backupStatus(db, { cfg = bucketConfig(), now = new Date() } = {}) {
  const row = db.prepare(
    'SELECT last_backup_at, last_backup_key, last_backup_attempt_at, last_backup_error FROM app_state WHERE id = 1'
  ).get() || {};
  const last = row.last_backup_at ? new Date(row.last_backup_at.replace(' ', 'T') + '+05:30') : null;
  const hoursSince = last ? (now.getTime() - last.getTime()) / 3600e3 : null;
  return {
    enabled: !!cfg,
    last_backup_at: row.last_backup_at || null,
    last_backup_key: row.last_backup_key || null,
    last_attempt_at: row.last_backup_attempt_at || null,
    last_error: row.last_backup_error || null,
    stale: !!cfg && (hoursSince === null || hoursSince > STALE_AFTER_HOURS),
  };
}

// Called every few minutes by the scheduler: back up once per IST day, after
// 11:30 pm -- or straight away if the last good backup is over 24 hours old
// (e.g. the app was down at 11:30 pm).
export function isBackupDue(status, now = new Date()) {
  if (!status.enabled) return false;
  const { date, time } = istParts(now);
  if (!status.last_backup_at) return true;
  const last = new Date(status.last_backup_at.replace(' ', 'T') + '+05:30');
  if (now.getTime() - last.getTime() > 24 * 3600e3) return true;
  return time >= BACKUP_TIME_IST && status.last_backup_at.slice(0, 10) < date;
}

