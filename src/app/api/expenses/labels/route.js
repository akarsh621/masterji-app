import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const result = requireAdmin(request);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');

    if (!category) {
      return NextResponse.json({ error: 'category param zaroori hai' }, { status: 400 });
    }

    const db = getDb();
    const rows = db.prepare(
      `SELECT DISTINCT label FROM expenses
       WHERE category = ? AND label IS NOT NULL AND label != ''
       ORDER BY created_at DESC LIMIT 10`
    ).all(category);

    return NextResponse.json({ labels: rows.map(r => r.label) });
  } catch (err) {
    console.error('Expense labels error:', err);
    return NextResponse.json({ error: 'Labels load karne mein gadbad' }, { status: 500 });
  }
}
