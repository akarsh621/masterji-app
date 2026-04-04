import { NextResponse } from 'next/server';
import { getDb, updateCashDrawer } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

const VALID_REASONS = new Set(['expense', 'supplier', 'owner', 'other', 'sweep', 'manual']);
const REASON_LABELS = { expense: 'Kharcha', supplier: 'Supplier Payment', owner: 'Owner Withdrawal', other: 'Other', sweep: 'Daily Sweep', manual: 'Manual Cash Out' };
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request) {
  try {
    const result = requireAuth(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const body = await request.json();
    const amount = Number(body?.amount);
    const reason = body?.reason;
    const note = typeof body?.note === 'string' ? body.note.trim() : '';

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Amount 0 se zyada hona chahiye' }, { status: 400 });
    }
    if (!VALID_REASONS.has(reason)) {
      return NextResponse.json({ error: 'Reason galat hai' }, { status: 400 });
    }
    if (reason === 'sweep' && result.user.role !== 'admin') {
      return NextResponse.json({ error: 'Sirf admin sweep kar sakta hai' }, { status: 403 });
    }
    if (reason === 'manual' && !note) {
      return NextResponse.json({ error: 'Cash out mein note zaroori hai' }, { status: 400 });
    }

    const db = getDb();
    const recordCashOut = db.transaction(() => {
      const info = db.prepare(
        'INSERT INTO cash_out (amount, reason, note, recorded_by) VALUES (?, ?, ?, ?)'
      ).run(amount, reason, note || null, result.user.id);
      updateCashDrawer(db, -amount);
      return info;
    });
    const info = recordCashOut();

    return NextResponse.json({
      message: 'Cash out record ho gaya',
      id: info.lastInsertRowid,
      amount,
      reason: REASON_LABELS[reason] || reason,
    }, { status: 201 });

  } catch (err) {
    console.error('Cash out error:', err);
    return NextResponse.json({ error: 'Cash out record karne mein gadbad' }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    const result = requireAuth(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (from && !DATE_ONLY_REGEX.test(from)) {
      return NextResponse.json({ error: 'From date format galat hai (YYYY-MM-DD)' }, { status: 400 });
    }
    if (to && !DATE_ONLY_REGEX.test(to)) {
      return NextResponse.json({ error: 'To date format galat hai (YYYY-MM-DD)' }, { status: 400 });
    }

    const db = getDb();

    let where = ['1=1'];
    let params = [];

    if (from) {
      where.push('co.created_at >= ?');
      params.push(`${from} 00:00:00`);
    }
    if (to) {
      where.push('co.created_at <= ?');
      params.push(`${to} 23:59:59`);
    }

    const whereClause = where.join(' AND ');

    const entries = db.prepare(`
      SELECT co.*, u.name as recorded_by_name
      FROM cash_out co
      JOIN users u ON co.recorded_by = u.id
      WHERE ${whereClause}
      ORDER BY co.created_at DESC
    `).all(...params);

    const summary = db.prepare(`
      SELECT
        COALESCE(SUM(co.amount), 0) as total,
        COALESCE(SUM(CASE WHEN co.reason = 'expense' THEN co.amount ELSE 0 END), 0) as expense_total,
        COALESCE(SUM(CASE WHEN co.reason = 'supplier' THEN co.amount ELSE 0 END), 0) as supplier_total,
        COALESCE(SUM(CASE WHEN co.reason = 'owner' THEN co.amount ELSE 0 END), 0) as owner_total,
        COALESCE(SUM(CASE WHEN co.reason = 'other' THEN co.amount ELSE 0 END), 0) as other_total,
        COUNT(*) as count
      FROM cash_out co
      WHERE ${whereClause}
    `).get(...params);

    return NextResponse.json({ entries, summary });

  } catch (err) {
    console.error('Cash out list error:', err);
    return NextResponse.json({ error: 'Cash out data load karne mein gadbad' }, { status: 500 });
  }
}
