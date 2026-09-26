import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { isValidDate, todayIST, matchQuarter, previousQuarter } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

// All period maths is done on plain YYYY-MM-DD calendar dates, so there are
// no timezone off-by-one errors (the old code formatted IST dates with UTC
// getters, which made every previous month lose its last day).
function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function mondayOf(ymd) {
  const day = new Date(ymd + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
  return addDays(ymd, day === 0 ? -6 : 1 - day);
}

function monthStart(ymd) {
  return ymd.slice(0, 7) + '-01';
}

function monthEnd(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

// Current and comparison periods for a dashboard request.
//   view=today  -> today vs yesterday
//   view=week   -> this Monday..today vs the whole previous week
//   view=month or month=YYYY-MM -> that month (up to today) vs the whole previous month
//   from/to     -> that range vs the same number of days just before it
//                  (a whole GST quarter, or the running one, vs the whole previous quarter)
function resolvePeriods({ view, from, to, month }) {
  const today = todayIST();
  if (from && to) {
    const quarter = matchQuarter(from, to, today);
    if (quarter) {
      const prevQ = previousQuarter(from);
      return { current: { from, to }, previous: { from: prevQ.from, to: prevQ.to } };
    }
    const days = Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000) + 1;
    const prevTo = addDays(from, -1);
    return { current: { from, to }, previous: { from: addDays(prevTo, -(days - 1)), to: prevTo } };
  }
  if (month || view === 'month') {
    const ym = month || today.slice(0, 7);
    const end = monthEnd(ym) < today ? monthEnd(ym) : today;
    const prevLast = addDays(`${ym}-01`, -1);
    return { current: { from: `${ym}-01`, to: end }, previous: { from: monthStart(prevLast), to: prevLast } };
  }
  if (view === 'week') {
    const monday = mondayOf(today);
    return { current: { from: monday, to: today }, previous: { from: addDays(monday, -7), to: addDays(monday, -1) } };
  }
  const yesterday = addDays(today, -1);
  return { current: { from: today, to: today }, previous: { from: yesterday, to: yesterday } };
}

function rangeConditions(range) {
  return {
    conditions: ['b.created_at >= ?', 'b.created_at <= ?'],
    params: [`${range.from} 00:00:00`, `${range.to} 23:59:59`],
  };
}

function runSummaryQuery(db, where, params) {
  const summary = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN b.type = 'sale' THEN 1 ELSE 0 END), 0) as total_bills,
      COALESCE(SUM(CASE WHEN b.type = 'return' THEN -b.total ELSE b.total END), 0) as net_revenue,
      COALESCE(SUM(CASE WHEN b.type = 'sale' THEN b.total ELSE 0 END), 0) as gross_revenue,
      COALESCE(SUM(CASE WHEN b.type = 'return' THEN b.total ELSE 0 END), 0) as total_returns,
      COALESCE(SUM(CASE WHEN b.type = 'sale' THEN CASE WHEN b.mrp_total > 0 THEN (b.mrp_total - b.total) ELSE b.discount_amount END ELSE 0 END), 0) as total_discount,
      COALESCE(SUM(CASE WHEN b.type = 'sale' THEN CASE WHEN b.mrp_total > 0 THEN b.mrp_total ELSE b.subtotal END ELSE 0 END), 0) as total_mrp,
      COALESCE(SUM(CASE WHEN b.type = 'sale' THEN 1 ELSE 0 END), 0) as sale_count,
      COALESCE(SUM(CASE WHEN b.type = 'return' THEN 1 ELSE 0 END), 0) as return_count
    FROM bills b
    WHERE ${where}
  `).get(...params);

  const paymentSplit = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN bp.mode = 'cash' THEN CASE WHEN b.type = 'return' THEN -bp.amount ELSE bp.amount END ELSE 0 END), 0) as cash_total,
      COALESCE(SUM(CASE WHEN bp.mode = 'upi' THEN CASE WHEN b.type = 'return' THEN -bp.amount ELSE bp.amount END ELSE 0 END), 0) as upi_total,
      COALESCE(SUM(CASE WHEN bp.mode = 'card' THEN CASE WHEN b.type = 'return' THEN -bp.amount ELSE bp.amount END ELSE 0 END), 0) as card_total
    FROM bill_payments bp
    JOIN bills b ON bp.bill_id = b.id
    WHERE ${where}
  `).get(...params);

  summary.cash_total = paymentSplit.cash_total;
  summary.upi_total = paymentSplit.upi_total;
  summary.card_total = paymentSplit.card_total;
  summary.total_revenue = summary.net_revenue;
  // Average bill = what a typical sale was worth (returns don't make bills smaller).
  summary.avg_bill = summary.sale_count > 0 ? summary.gross_revenue / summary.sale_count : 0;

  const totalItems = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN b.type = 'return' THEN -bi.quantity ELSE bi.quantity END), 0) as total_items
    FROM bill_items bi
    JOIN bills b ON bi.bill_id = b.id
    WHERE ${where}
  `).get(...params);

  summary.total_items = totalItems.total_items;

  return summary;
}

export async function GET(request) {
  try {
    const result = requireAuth(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { searchParams } = new URL(request.url);
    // Salesmen see today's sales figures only (their Aaj tab); any other range is admin-only.
    const isAdmin = result.user.role === 'admin';
    const view = isAdmin ? (searchParams.get('view') || 'today').toLowerCase() : 'today';
    const from = isAdmin ? searchParams.get('from') : null;
    const to = isAdmin ? searchParams.get('to') : null;
    const month = isAdmin ? searchParams.get('month') : null;
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json({ error: 'Month format galat hai (YYYY-MM)' }, { status: 400 });
    }

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

    // One of from/to without the other is treated as no custom range.
    const periods = resolvePeriods({ view, from: from && to ? from : null, to: from && to ? to : null, month });
    const { conditions: dateConditions, params: dateParams } = rangeConditions(periods.current);
    const baseConditions = [...dateConditions, 'b.deleted_at IS NULL'];
    const baseParams = [...dateParams];

    const baseWhere = baseConditions.join(' AND ');

    const summary = runSummaryQuery(db, baseWhere, baseParams);

    const { conditions: prevConditions, params: prevParams } = rangeConditions(periods.previous);
    const prevBaseConditions = [...prevConditions, 'b.deleted_at IS NULL'];
    const prevBaseParams = [...prevParams];
    const prevWhere = prevBaseConditions.join(' AND ');
    const previous_summary = runSummaryQuery(db, prevWhere, prevBaseParams);

    const categoryBreakdown = db.prepare(`
      SELECT
        c.name as category_name,
        c.group_name,
        SUM(CASE WHEN b.type = 'return' THEN -bi.quantity ELSE bi.quantity END) as quantity,
        SUM((CASE WHEN b.type = 'return' THEN -bi.amount ELSE bi.amount END)
            * (CASE WHEN b.subtotal > 0 THEN b.total / b.subtotal ELSE 1 END)) as revenue
      FROM bill_items bi
      JOIN bills b ON bi.bill_id = b.id
      JOIN categories c ON bi.category_id = c.id
      WHERE ${baseWhere}
      GROUP BY c.id
      HAVING ABS(revenue) >= 0.01 OR quantity != 0
      ORDER BY revenue DESC
    `).all(...baseParams);

    const dailyTrend = db.prepare(`
      SELECT
        date(b.created_at) as date,
        SUM(CASE WHEN b.type = 'sale' THEN 1 ELSE 0 END) as bills,
        SUM(CASE WHEN b.type = 'return' THEN -b.total ELSE b.total END) as revenue
      FROM bills b
      WHERE ${baseWhere}
      GROUP BY date(b.created_at)
      ORDER BY date ASC
    `).all(...baseParams);

    let weeklyTrend = [];
    if (view === 'month' || month || (from && to)) {
      const weekRows = db.prepare(`
        SELECT
          date(b.created_at, 'weekday 0', '-6 days') as week_start,
          date(b.created_at, 'weekday 0') as week_end,
          SUM(CASE WHEN b.type = 'sale' THEN 1 ELSE 0 END) as bills,
          SUM(CASE WHEN b.type = 'return' THEN -b.total ELSE b.total END) as revenue
        FROM bills b
        WHERE ${baseWhere}
        GROUP BY week_start
        ORDER BY week_start ASC
      `).all(...baseParams);
      weeklyTrend = weekRows;
    }

    let salesmanBreakdown = db.prepare(`
      SELECT
        b.salesman_id,
        u.name as salesman_name,
        SUM(CASE WHEN b.type = 'sale' THEN 1 ELSE 0 END) as bills,
        COALESCE(SUM(CASE WHEN b.type = 'return' THEN -b.total ELSE b.total END), 0) as revenue
      FROM bills b
      JOIN users u ON b.salesman_id = u.id
      WHERE ${baseWhere}
      GROUP BY b.salesman_id, u.name
      ORDER BY revenue DESC
    `).all(...baseParams);

    for (const s of salesmanBreakdown) {
      const itemCount = db.prepare(`
        SELECT COALESCE(SUM(CASE WHEN b.type = 'return' THEN -bi.quantity ELSE bi.quantity END), 0) as items
        FROM bill_items bi
        JOIN bills b ON bi.bill_id = b.id
        WHERE b.salesman_id = ? AND ${baseWhere}
      `).get(s.salesman_id, ...baseParams);
      s.items = itemCount.items;
    }

    // Earliest bill date, so the Quarter list starts at the app's first quarter.
    const firstBill = db.prepare('SELECT MIN(created_at) AS first FROM bills WHERE deleted_at IS NULL').get();

    return NextResponse.json({
      period: periods,
      first_bill_date: firstBill.first ? firstBill.first.slice(0, 10) : null,
      summary,
      previous_summary,
      categoryBreakdown,
      dailyTrend,
      weeklyTrend,
      salesmanBreakdown,
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    return NextResponse.json({ error: 'Dashboard load karne mein gadbad' }, { status: 500 });
  }
}
