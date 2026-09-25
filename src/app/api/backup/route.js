import { NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { getDb } from '@/lib/db';
import { requireAdminOrAgent } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function istDateStamp() {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 16).replace('T', '_').replace(':', '');
}

// Full database snapshot as a download. Uses SQLite's online backup, which is
// consistent even while the app is writing (never copy a live WAL file directly).
export async function GET(request) {
  const auth = requireAdminOrAgent(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const tmpFile = path.join(os.tmpdir(), `masterji-backup-${process.pid}-${Date.now()}.db`);
  try {
    await getDb().backup(tmpFile);
    // Hand out a single self-contained file: switch the copy out of WAL mode so
    // opening or restoring it never needs (or creates) -wal / -shm side files.
    const copy = new Database(tmpFile);
    copy.pragma('journal_mode = DELETE');
    copy.close();
    const data = fs.readFileSync(tmpFile);
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="masterji-${istDateStamp()}.db"`,
        'Content-Length': String(data.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('Backup error:', err);
    return NextResponse.json({ error: 'Backup nahi ban paya' }, { status: 500 });
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}
