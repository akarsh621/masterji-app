import { NextResponse } from 'next/server';
import { getDb, getISTNow } from '@/lib/db';
import { requireAuth, requireAuthOrAgent } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const auth = requireAuth(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { bill_id } = await request.json();
    if (!bill_id) {
      return NextResponse.json({ error: 'bill_id zaroori hai' }, { status: 400 });
    }

    const db = getDb();
    const bill = db.prepare('SELECT id FROM bills WHERE id = ? AND deleted_at IS NULL').get(bill_id);
    if (!bill) {
      return NextResponse.json({ error: 'Bill nahi mila' }, { status: 404 });
    }

    const result = db.prepare(
      'INSERT INTO print_queue (bill_id, requested_by) VALUES (?, ?)'
    ).run(bill_id, auth.user.id);

    return NextResponse.json({ id: result.lastInsertRowid, status: 'pending' }, { status: 201 });
  } catch (err) {
    console.error('Print queue POST error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    const auth = requireAuthOrAgent(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';

    const db = getDb();

    if (status === 'pending') {
      db.prepare(`
        UPDATE print_queue SET status = 'failed'
        WHERE status = 'pending'
        AND created_at < datetime('now', '+5 hours', '+30 minutes', '-10 minutes')
      `).run();
    }

    const jobs = db.prepare(`
      SELECT pq.id as queue_id, pq.status as queue_status, pq.created_at as queued_at,
             b.id as bill_id, b.bill_number, b.subtotal, b.mrp_total,
             b.discount_percent, b.discount_amount, b.total,
             b.payment_mode, b.notes, b.created_at,
             s.name as salesman_name, u.name as requested_by_name
      FROM print_queue pq
      JOIN bills b ON b.id = pq.bill_id
      JOIN users s ON s.id = b.salesman_id
      LEFT JOIN users u ON u.id = pq.requested_by
      WHERE pq.status = ?
      ORDER BY pq.created_at ASC
      LIMIT 50
    `).all(status);

    if (jobs.length === 0) return NextResponse.json([]);

    const billIds = jobs.map(j => j.bill_id);
    const ph = billIds.map(() => '?').join(',');

    const allItems = db.prepare(`
      SELECT bi.bill_id, bi.category_id, bi.mrp, bi.quantity, bi.amount,
             c.name as category_name
      FROM bill_items bi
      JOIN categories c ON bi.category_id = c.id
      WHERE bi.bill_id IN (${ph})
    `).all(...billIds);

    const allPayments = db.prepare(`
      SELECT bill_id, mode, amount FROM bill_payments WHERE bill_id IN (${ph})
    `).all(...billIds);

    const itemsByBill = {};
    for (const item of allItems) {
      if (!itemsByBill[item.bill_id]) itemsByBill[item.bill_id] = [];
      itemsByBill[item.bill_id].push(item);
    }
    const paymentsByBill = {};
    for (const p of allPayments) {
      if (!paymentsByBill[p.bill_id]) paymentsByBill[p.bill_id] = [];
      paymentsByBill[p.bill_id].push(p);
    }

    const result = jobs.map(j => ({
      queue_id: j.queue_id,
      queue_status: j.queue_status,
      queued_at: j.queued_at,
      bill_id: j.bill_id,
      bill_number: j.bill_number,
      subtotal: j.subtotal,
      mrp_total: j.mrp_total,
      discount_percent: j.discount_percent,
      discount_amount: j.discount_amount,
      total: j.total,
      payment_mode: j.payment_mode,
      notes: j.notes,
      created_at: j.created_at,
      salesman_name: j.salesman_name,
      requested_by_name: j.requested_by_name,
      items: itemsByBill[j.bill_id] || [],
      payments: paymentsByBill[j.bill_id] || [],
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error('Print queue GET error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const auth = requireAuthOrAgent(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const db = getDb();
    const result = db.prepare(
      "UPDATE print_queue SET status = 'failed' WHERE status = 'pending'"
    ).run();

    return NextResponse.json({ cleared: result.changes });
  } catch (err) {
    console.error('Print queue DELETE error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
