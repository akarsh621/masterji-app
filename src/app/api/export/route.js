import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function csvEscape(value) {
  const str = value == null ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

export async function GET(request) {
  try {
    const result = requireAdmin(request);
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
    if (from && to && from > to) {
      return NextResponse.json({ error: 'From date, To date se chhoti honi chahiye' }, { status: 400 });
    }

    const db = getDb();

    let where = ['b.deleted_at IS NULL'];
    let params = [];

    if (from) {
      where.push('b.created_at >= ?');
      params.push(`${from} 00:00:00`);
    }
    if (to) {
      where.push('b.created_at <= ?');
      params.push(to + ' 23:59:59');
    }

    const whereClause = where.join(' AND ');

    const rows = db.prepare(`
      SELECT
        b.bill_number,
        b.type,
        b.original_bill_id,
        b.created_at as date,
        u.name as salesman,
        c.name as category,
        c.group_name as group_name,
        bi.quantity,
        bi.amount as item_amount,
        b.subtotal,
        b.discount_percent,
        b.discount_amount,
        b.total,
        b.payment_mode,
        b.notes
      FROM bill_items bi
      JOIN bills b ON bi.bill_id = b.id
      JOIN categories c ON bi.category_id = c.id
      JOIN users u ON b.salesman_id = u.id
      WHERE ${whereClause}
      ORDER BY b.created_at DESC, b.id, bi.id
    `).all(...params);

    const billIds = [...new Set(rows.map(r => r.bill_number))];
    const billPayments = {};
    if (billIds.length > 0) {
      const allPayments = db.prepare(`
        SELECT b.bill_number, bp.mode, bp.amount
        FROM bill_payments bp
        JOIN bills b ON bp.bill_id = b.id
        WHERE ${whereClause}
        ORDER BY bp.id
      `).all(...params);
      for (const p of allPayments) {
        if (!billPayments[p.bill_number]) billPayments[p.bill_number] = [];
        billPayments[p.bill_number].push(`${p.mode}:${p.amount}`);
      }
    }

    const headers = [
      'Bill Number', 'Type', 'Date', 'Salesman', 'Category', 'Group',
      'Quantity', 'Item Amount', 'Bill Subtotal', 'Discount %',
      'Discount Amount', 'Bill Total', 'Payment Mode', 'Payment Split', 'Notes'
    ];

    let csv = headers.join(',') + '\n';

    for (const row of rows) {
      const split = billPayments[row.bill_number]?.join('; ') || row.payment_mode;
      const line = [
        row.bill_number,
        row.type || 'sale',
        row.date,
        row.salesman,
        row.category,
        row.group_name,
        row.quantity,
        row.item_amount,
        row.subtotal,
        row.discount_percent,
        row.discount_amount,
        row.total,
        row.payment_mode,
        split,
        row.notes || '',
      ].map(csvEscape).join(',');
      csv += line + '\n';
    }

    const filename = `masterji-sales${from ? `-from-${from}` : ''}${to ? `-to-${to}` : ''}.csv`;

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });

  } catch (err) {
    console.error('Export error:', err);
    return NextResponse.json({ error: 'Export mein gadbad' }, { status: 500 });
  }
}
