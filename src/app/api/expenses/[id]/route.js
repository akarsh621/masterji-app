import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export async function PATCH(request, { params }) {
  try {
    const result = requireAdmin(request);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });

    const { id } = await params;
    const db = getDb();
    const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Expense nahi mila' }, { status: 404 });
    }

    const body = await request.json();
    const updates = [];
    const values = [];

    if (body.amount !== undefined) {
      if (typeof body.amount !== 'number' || body.amount <= 0 || !isFinite(body.amount)) {
        return NextResponse.json({ error: 'Amount positive number hona chahiye' }, { status: 400 });
      }
      updates.push('amount = ?');
      values.push(body.amount);
    }
    if (body.label !== undefined) {
      updates.push('label = ?');
      values.push(body.label?.trim() || null);
    }
    if (body.note !== undefined) {
      updates.push('note = ?');
      values.push(body.note?.trim() || null);
    }
    if (body.expense_date !== undefined) {
      if (body.expense_date && !DATE_REGEX.test(body.expense_date)) {
        return NextResponse.json({ error: 'expense_date YYYY-MM-DD format mein hona chahiye' }, { status: 400 });
      }
      if (body.expense_date && !body.expense_date.startsWith(existing.expense_month)) {
        return NextResponse.json({ error: 'expense_date selected month ke andar honi chahiye' }, { status: 400 });
      }
      updates.push('expense_date = ?');
      values.push(body.expense_date || null);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Kuch update karne ko nahi mila' }, { status: 400 });
    }

    values.push(id);
    db.prepare(`UPDATE expenses SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    return NextResponse.json(updated);
  } catch (err) {
    console.error('Expense PATCH error:', err);
    return NextResponse.json({ error: 'Expense update karne mein gadbad' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const result = requireAdmin(request);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });

    const { id } = await params;
    const db = getDb();
    const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Expense nahi mila' }, { status: 404 });
    }

    db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Expense DELETE error:', err);
    return NextResponse.json({ error: 'Expense delete karne mein gadbad' }, { status: 500 });
  }
}
