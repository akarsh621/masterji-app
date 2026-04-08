import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES = ['stock_purchase', 'salaries', 'shop_utilities', 'other'];
const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export async function GET(request) {
  try {
    const result = requireAdmin(request);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');

    if (!month || !MONTH_REGEX.test(month)) {
      return NextResponse.json({ error: 'month param zaroori hai (YYYY-MM)' }, { status: 400 });
    }

    const db = getDb();

    const expenses = db.prepare(
      'SELECT * FROM expenses WHERE expense_month = ? ORDER BY category, expense_date ASC, created_at ASC'
    ).all(month);

    const totalsRows = db.prepare(
      'SELECT category, COALESCE(SUM(amount), 0) as total FROM expenses WHERE expense_month = ? GROUP BY category'
    ).all(month);

    const totals = { stock_purchase: 0, salaries: 0, shop_utilities: 0, other: 0, total: 0 };
    for (const row of totalsRows) {
      totals[row.category] = row.total;
      totals.total += row.total;
    }

    return NextResponse.json({ expenses, totals });
  } catch (err) {
    console.error('Expenses GET error:', err);
    return NextResponse.json({ error: 'Expenses load karne mein gadbad' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const result = requireAdmin(request);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });

    const body = await request.json();
    const { category, amount, label, note, expense_month, expense_date } = body;

    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: 'Valid category select karo' }, { status: 400 });
    }
    if (!amount || typeof amount !== 'number' || amount <= 0 || !isFinite(amount)) {
      return NextResponse.json({ error: 'Amount positive number hona chahiye' }, { status: 400 });
    }
    if (!expense_month || !MONTH_REGEX.test(expense_month)) {
      return NextResponse.json({ error: 'expense_month YYYY-MM format mein hona chahiye' }, { status: 400 });
    }
    if (expense_date) {
      if (!DATE_REGEX.test(expense_date)) {
        return NextResponse.json({ error: 'expense_date YYYY-MM-DD format mein hona chahiye' }, { status: 400 });
      }
      if (!expense_date.startsWith(expense_month)) {
        return NextResponse.json({ error: 'expense_date selected month ke andar honi chahiye' }, { status: 400 });
      }
    }
    if ((category === 'stock_purchase' || category === 'salaries') && !label?.trim()) {
      const fieldName = category === 'stock_purchase' ? 'Supplier name' : 'Person name';
      return NextResponse.json({ error: `${fieldName} zaroori hai` }, { status: 400 });
    }

    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO expenses (category, amount, label, note, expense_month, expense_date, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      category, amount,
      label?.trim() || null,
      note?.trim() || null,
      expense_month,
      expense_date || null,
      result.user.id
    );

    const created = db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error('Expenses POST error:', err);
    return NextResponse.json({ error: 'Expense save karne mein gadbad' }, { status: 500 });
  }
}
