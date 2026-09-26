import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { isValidDate } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

function csvEscape(value) {
  let str = value == null ? '' : String(value);
  // Text starting with = + - @ (or tab/CR) would run as a formula in Excel or
  // Sheets. Numbers are left alone so negative amounts stay numeric.
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
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

    if (from && !isValidDate(from)) {
      return NextResponse.json({ error: 'From date format galat hai (YYYY-MM-DD)' }, { status: 400 });
    }
    if (to && !isValidDate(to)) {
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
      params.push(`${to} 23:59:59`);
    }

    const whereClause = where.join(' AND ');

    const bills = db.prepare(`
      SELECT
        b.id,
        b.bill_number,
        b.type,
        b.created_at,
        u.name as salesman,
        b.mrp_total,
        b.subtotal,
        b.discount_percent,
        b.discount_amount,
        b.total,
        b.payment_mode,
        b.notes,
        b.customer_name,
        cu.phone AS customer_phone,
        ob.bill_number AS original_bill_number
      FROM bills b
      JOIN users u ON b.salesman_id = u.id
      LEFT JOIN customers cu ON cu.id = b.customer_id
      LEFT JOIN bills ob ON ob.id = b.original_bill_id
      WHERE ${whereClause}
      ORDER BY b.created_at DESC, b.id
    `).all(...params);

    const billIds = bills.map(b => b.id);

    const itemsByBill = {};
    const paymentsByBill = {};

    if (billIds.length > 0) {
      const placeholders = billIds.map(() => '?').join(',');

      const items = db.prepare(`
        SELECT bi.bill_id, c.name as category, bi.quantity
        FROM bill_items bi
        JOIN categories c ON bi.category_id = c.id
        WHERE bi.bill_id IN (${placeholders})
        ORDER BY bi.id
      `).all(...billIds);

      for (const item of items) {
        if (!itemsByBill[item.bill_id]) itemsByBill[item.bill_id] = [];
        itemsByBill[item.bill_id].push(item);
      }

      const payments = db.prepare(`
        SELECT bp.bill_id, bp.mode, bp.amount
        FROM bill_payments bp
        WHERE bp.bill_id IN (${placeholders})
        ORDER BY bp.id
      `).all(...billIds);

      for (const p of payments) {
        if (!paymentsByBill[p.bill_id]) paymentsByBill[p.bill_id] = [];
        paymentsByBill[p.bill_id].push(p);
      }
    }

    const headers = [
      'Bill No', 'Type', 'Date', 'Time', 'Salesman',
      'Qty', 'MRP Total', 'Subtotal', 'Discount %', 'Discount Amt',
      'Total', 'Payment Mode', 'Payment Split', 'Items Detail', 'Notes',
      'Customer Phone', 'Customer Name', 'Against Bill'
    ];

    let csv = headers.join(',') + '\n';

    for (const bill of bills) {
      const items = itemsByBill[bill.id] || [];
      const payments = paymentsByBill[bill.id] || [];

      // Return rows are negative (money and pieces), so summing any column in a
      // spreadsheet gives the true net figure for the period.
      const sign = bill.type === 'return' ? -1 : 1;
      const money = (v) => sign * (Math.round((v || 0) * 100) / 100);
      const totalQty = sign * items.reduce((s, i) => s + i.quantity, 0);

      const itemDetail = items.map(i =>
        `${i.category} x${i.quantity}`
      ).join(', ');

      const paymentSplit = payments.map(p =>
        `${p.mode}:${money(p.amount)}`
      ).join(', ');

      const dateStr = bill.created_at ? bill.created_at.split(' ')[0] : '';
      const timeStr = bill.created_at ? (bill.created_at.split(' ')[1] || '').slice(0, 5) : '';

      const line = [
        bill.bill_number,
        bill.type || 'sale',
        dateStr,
        timeStr,
        bill.salesman,
        totalQty,
        money(bill.mrp_total),
        money(bill.subtotal),
        bill.discount_percent || 0,
        money(bill.discount_amount),
        money(bill.total),
        bill.payment_mode,
        paymentSplit,
        itemDetail,
        bill.notes || '',
        bill.customer_phone || '',
        bill.customer_name || '',
        bill.original_bill_number || '',
      ].map(csvEscape).join(',');

      csv += line + '\n';
    }

    const filename = `masterji-bills${from ? `-from-${from}` : ''}${to ? `-to-${to}` : ''}.csv`;

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
