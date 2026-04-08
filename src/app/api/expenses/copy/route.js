import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function POST(request) {
  try {
    const result = requireAdmin(request);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });

    const { from_month, to_month } = await request.json();

    if (!from_month || !MONTH_REGEX.test(from_month)) {
      return NextResponse.json({ error: 'from_month YYYY-MM format mein hona chahiye' }, { status: 400 });
    }
    if (!to_month || !MONTH_REGEX.test(to_month)) {
      return NextResponse.json({ error: 'to_month YYYY-MM format mein hona chahiye' }, { status: 400 });
    }

    const db = getDb();

    const existingCount = db.prepare(
      'SELECT COUNT(*) as count FROM expenses WHERE expense_month = ?'
    ).get(to_month);
    if (existingCount.count > 0) {
      return NextResponse.json({ error: 'Is mahine mein pehle se expenses hain — double copy nahi hoga' }, { status: 400 });
    }

    const sourceCount = db.prepare(
      'SELECT COUNT(*) as count FROM expenses WHERE expense_month = ?'
    ).get(from_month);
    if (sourceCount.count === 0) {
      return NextResponse.json({ error: 'Source month mein koi expense nahi hai' }, { status: 400 });
    }

    const info = db.prepare(
      `INSERT INTO expenses (category, amount, label, note, expense_month, expense_date, recorded_by)
       SELECT category, amount, label, note, ?, NULL, ?
       FROM expenses WHERE expense_month = ?`
    ).run(to_month, result.user.id, from_month);

    return NextResponse.json({ copied: info.changes });
  } catch (err) {
    console.error('Expenses copy error:', err);
    return NextResponse.json({ error: 'Expenses copy karne mein gadbad' }, { status: 500 });
  }
}
