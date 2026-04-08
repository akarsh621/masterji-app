import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

function getLastDayOfMonth(yyyy, mm) {
  return new Date(yyyy, mm, 0).getDate();
}

function getPreviousMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

function getMonthData(db, month) {
  const [yyyy, mm] = month.split('-').map(Number);
  const lastDay = getLastDayOfMonth(yyyy, mm);
  const from = `${month}-01 00:00:00`;
  const to = `${month}-${String(lastDay).padStart(2, '0')} 23:59:59`;

  const rev = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN b.type = 'sale' THEN b.total ELSE 0 END), 0) as total_sales,
      COALESCE(SUM(CASE WHEN b.type = 'return' THEN b.total ELSE 0 END), 0) as total_returns,
      COALESCE(SUM(CASE WHEN b.type = 'sale' THEN 1 ELSE 0 END), 0) as sale_count,
      COALESCE(SUM(CASE WHEN b.type = 'return' THEN 1 ELSE 0 END), 0) as return_count,
      COALESCE(SUM(CASE WHEN b.type = 'sale' THEN
        CASE WHEN b.mrp_total > 0 THEN b.mrp_total ELSE b.subtotal END
      ELSE 0 END), 0) as total_mrp
    FROM bills b
    WHERE b.deleted_at IS NULL
      AND b.created_at >= ? AND b.created_at <= ?
  `).get(from, to);

  const items = db.prepare(`
    SELECT COALESCE(SUM(bi.quantity), 0) as total_items
    FROM bill_items bi JOIN bills b ON bi.bill_id = b.id
    WHERE b.deleted_at IS NULL AND b.type = 'sale'
      AND b.created_at >= ? AND b.created_at <= ?
  `).get(from, to);

  const activeDays = db.prepare(`
    SELECT COUNT(DISTINCT date(b.created_at)) as active_days
    FROM bills b
    WHERE b.deleted_at IS NULL AND b.type = 'sale'
      AND b.created_at >= ? AND b.created_at <= ?
  `).get(from, to);

  const net_revenue = rev.total_sales - rev.total_returns;
  const total_discount = rev.total_mrp - rev.total_sales;
  const discount_pct = rev.total_mrp > 0 ? Math.round((total_discount / rev.total_mrp) * 1000) / 10 : 0;

  const revenue = {
    total_sales: rev.total_sales,
    total_returns: rev.total_returns,
    net_revenue,
    total_mrp: rev.total_mrp,
    total_discount,
    discount_pct,
    sale_count: rev.sale_count,
    return_count: rev.return_count,
    total_items: items.total_items,
    active_days: activeDays.active_days,
  };

  const expRows = db.prepare(
    'SELECT category, COALESCE(SUM(amount), 0) as total FROM expenses WHERE expense_month = ? GROUP BY category'
  ).all(month);

  const expenses = { stock_purchase: 0, salaries: 0, shop_utilities: 0, other: 0, total: 0 };
  for (const row of expRows) {
    expenses[row.category] = row.total;
    expenses.total += row.total;
  }

  const net_profit = net_revenue - expenses.total;
  const profit_margin_pct = net_revenue > 0 ? Math.round((net_profit / net_revenue) * 1000) / 10 : 0;
  const expense_ratio_pct = net_revenue > 0 ? Math.round((expenses.total / net_revenue) * 1000) / 10 : 0;
  const stock_pct = net_revenue > 0 ? Math.round((expenses.stock_purchase / net_revenue) * 1000) / 10 : 0;

  return {
    month,
    revenue,
    expenses,
    pnl: { net_profit, profit_margin_pct, expense_ratio_pct, stock_pct },
  };
}

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
    const current = getMonthData(db, month);
    const prevMonth = getPreviousMonth(month);
    const previous = getMonthData(db, prevMonth);

    return NextResponse.json({ ...current, previous });
  } catch (err) {
    console.error('Earnings error:', err);
    return NextResponse.json({ error: 'Earnings load karne mein gadbad' }, { status: 500 });
  }
}
