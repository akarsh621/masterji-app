import { NextResponse } from 'next/server';
import { getDb, getISTNow, updateCashDrawer } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export async function DELETE(request, { params }) {
  try {
    const result = requireAuth(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { id } = await params;
    const db = getDb();

    const bill = db.prepare(`
      SELECT b.*, u.name as salesman_name
      FROM bills b
      JOIN users u ON b.salesman_id = u.id
      WHERE b.id = ? AND b.deleted_at IS NULL
    `).get(id);
    if (!bill) {
      return NextResponse.json({ error: 'Bill nahi mila' }, { status: 404 });
    }

    if (result.user.role === 'salesman') {
      if (bill.salesman_id !== result.user.id) {
        return NextResponse.json({ error: 'Sirf apna bill cancel kar sakte ho' }, { status: 403 });
      }
      const createdAt = new Date(bill.created_at.replace(' ', 'T') + '+05:30');
      const minutesOld = (Date.now() - createdAt.getTime()) / 60000;
      if (minutesOld > 15) {
        return NextResponse.json({ error: '15 minute se zyada ho gaye, admin se bolo' }, { status: 403 });
      }
    }

    const items = db.prepare(`
      SELECT bi.*, c.name as category_name, c.group_name
      FROM bill_items bi
      JOIN categories c ON bi.category_id = c.id
      WHERE bi.bill_id = ?
    `).all(id);

    const payments = db.prepare('SELECT * FROM bill_payments WHERE bill_id = ?').all(id);

    const voidBill = db.transaction(() => {
      db.prepare('UPDATE bills SET deleted_at = ? WHERE id = ?').run(getISTNow(), id);

      const cashAmount = payments
        .filter(p => p.mode === 'cash')
        .reduce((s, p) => s + p.amount, 0);
      if (cashAmount > 0) {
        updateCashDrawer(db, bill.type === 'return' ? cashAmount : -cashAmount);
      }
    });
    voidBill();

    return NextResponse.json({
      message: `Bill ${bill.bill_number} void ho gaya`,
      voided_bill: {
        ...bill,
        items,
        payments,
      }
    });

  } catch (err) {
    console.error('Delete bill error:', err);
    return NextResponse.json({ error: 'Bill delete karne mein gadbad' }, { status: 500 });
  }
}
