import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { runBackup, backupStatus } from '@/lib/backup';

export const dynamic = 'force-dynamic';

// "Backup now" (admin): uploads a copy to the bucket straight away.
export async function POST(request) {
  const auth = requireAdmin(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db = getDb();
  const result = await runBackup(db);
  const status = backupStatus(db);
  if (!result.ok) return NextResponse.json({ error: `Backup nahi hua: ${result.error}`, status }, { status: 502 });
  return NextResponse.json({ message: 'Backup ho gaya', uploaded: result.uploaded, status });
}
