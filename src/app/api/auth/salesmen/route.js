import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const salesmen = db.prepare(
      "SELECT id, name FROM users WHERE role = 'salesman' AND active = 1 ORDER BY name"
    ).all();
    return NextResponse.json({ salesmen });
  } catch (err) {
    console.error('Salesmen list error:', err);
    return NextResponse.json({ error: 'Kuch gadbad ho gayi' }, { status: 500 });
  }
}
