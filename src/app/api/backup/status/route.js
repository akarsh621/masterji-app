import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { backupStatus } from '@/lib/backup';

export const dynamic = 'force-dynamic';

// Last automatic bucket backup, for Settings and the Hisaab warning (admin).
export async function GET(request) {
  const auth = requireAdmin(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(backupStatus(getDb()));
}
