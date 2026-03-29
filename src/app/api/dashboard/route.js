import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isDateOnly(value) {
  return DATE_ONLY_REGEX.test(value);
}

function buildDateConditions(view, from, to) {
  const conditions = [];
  const params = [];
  const hasCustomRange = Boolean(from || to);

  if (hasCustomRange) {
    if (from) {
      conditions.push('b.created_at >= ?');
      params.push(`${from} 00:00:00`);
    }
    if (to) {
      conditions.push('b.created_at <= ?');
      params.push(`${to} 23:59:59`);
    }
  } else if (view === 'today') {
    conditions.push("date(b.created_at) = date('now', '+5 hours', '+30 minutes')");
  } else if (view === 'week') {
    conditions.push("b.created_at >= datetime('now', '+5 hours', '+30 minutes', '-7 days')");
  } else if (view === 'month') {
    conditions.push("b.created_at >= datetime('now', '+5 hours', '+30 minutes', '-30 days')");
  } else {
    conditions.push("date(b.created_at) = date('now', '+5 hours', '+30 minutes')");
  }

  return { conditions, params };
}

function buildPreviousPeriodConditions(view, from, to) {
  const conditions = [];
  const params = [];
  const hasCustomRange = Boolean(from && to);

  if (hasCustomRange) {
    const fromDate = new Date(from + 'T00:00:00+05:30');
    const toDate = new Date(to + 'T23:59:59+05:30');
    const durationMs = toDate.getTime() - fromDate.getTime();
    const prevTo = new Date(fromDate.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - durationMs);
    const fmtDate = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    conditions.push('b.created_at >= ?');
    params.push(`${fmtDate(prevFrom)} 00:00:00`);
    conditions.push('b.created_at <= ?');
    params.push(`${fmtDate(prevTo)} 23:59:59`);
  } else if (view === 'today') {
    conditions.push("date(b.created_at) = date('now', '+5 hours', '+30 minutes', '-1 day')");
  } else if (view === 'week') {
    conditions.push("b.created_at >= datetime('now', '+5 hours', '+30 minutes', '-14 days')");
    conditions.push("b.created_at < datetime('now', '+5 hours', '+30 minutes', '-7 days')");
  } else if (view === 'month') {
    conditions.push("b.created_at >= datetime('now', '+5 hours', '+30 minutes', '-60 days')");
    conditions.push("b.created_at < datetime('now', '+5 hours', '+30 minutes', '-30 days')");
  } else {
    conditions.push("date(b.created_at) = date('now', '+5 hours', '+30 minutes', '-1 day')");
  }

  return { conditions, params };
}

function runSummaryQuery(db, where, params) {
  const summary = db.prepare(`
    SELECT
      COUNT(*) as total_bills,
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

  const totalItems = db.prepare(`
    SELECT COALESCE(SUM(bi.quantity), 0) as total_items
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
    const view = (searchParams.get('view') || 'today').toLowerCase();
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (from && !isDateOnly(from)) {
      return NextResponse.json({ error: 'From date format galat hai (YYYY-MM-DD)' }, { status: 400 });
    }
    if (to && !isDateOnly(to)) {
      return NextResponse.json({ error: 'To date format galat hai (YYYY-MM-DD)' }, { status: 400 });
    }
    if (from && to && from > to) {
      return NextResponse.json({ error: 'From date, To date se chhoti honi chahiye' }, { status: 400 });
    }

    const db = getDb();

    const { conditions: dateConditions, params: dateParams } = buildDateConditions(view, from, to);
    const baseConditions = [...dateConditions, 'b.deleted_at IS NULL'];
    const baseParams = [...dateParams];

    const scopedConditions = [...baseConditions];
    const scopedParams = [...baseParams];
    if (result.user.role === 'salesman') {
      scopedConditions.push('b.salesman_id = ?');
      scopedParams.push(result.user.id);
    }

    const scopedWhere = scopedConditions.join(' AND ');
    const baseWhere = baseConditions.join(' AND ');

    const summary = runSummaryQuery(db, scopedWhere, scopedParams);

    const { conditions: prevConditions, params: prevParams } = buildPreviousPeriodConditions(view, from, to);
    const prevBaseConditions = [...prevConditions, 'b.deleted_at IS NULL'];
    const prevBaseParams = [...prevParams];
    const prevScopedConditions = [...prevBaseConditions];
    const prevScopedParams = [...prevBaseParams];
    if (result.user.role === 'salesman') {
      prevScopedConditions.push('b.salesman_id = ?');
      prevScopedParams.push(result.user.id);
    }
    const prevWhere = prevScopedConditions.join(' AND ');
    const previous_summary = runSummaryQuery(db, prevWhere, prevScopedParams);

    const categoryBreakdown = db.prepare(`
      SELECT
        c.name as category_name,
        c.group_name,
        SUM(CASE WHEN b.type = 'return' THEN -bi.quantity ELSE bi.quantity END) as quantity,
        SUM(CASE WHEN b.type = 'return' THEN -bi.amount ELSE bi.amount END) as revenue
      FROM bill_items bi
      JOIN bills b ON bi.bill_id = b.id
      JOIN categories c ON bi.category_id = c.id
      WHERE ${scopedWhere}
      GROUP BY c.id
      HAVING revenue > 0
      ORDER BY revenue DESC
    `).all(...scopedParams);

    const dailyTrend = db.prepare(`
      SELECT
        date(b.created_at) as date,
        COUNT(*) as bills,
        SUM(CASE WHEN b.type = 'return' THEN -b.total ELSE b.total END) as revenue
      FROM bills b
      WHERE ${scopedWhere}
      GROUP BY date(b.created_at)
      ORDER BY date ASC
    `).all(...scopedParams);

    let salesmanBreakdown = [];
    if (result.user.role === 'admin') {
      salesmanBreakdown = db.prepare(`
        SELECT
          b.salesman_id,
          u.name as salesman_name,
          COUNT(b.id) as bills,
          COALESCE(SUM(CASE WHEN b.type = 'return' THEN -b.total ELSE b.total END), 0) as revenue
        FROM bills b
        JOIN users u ON b.salesman_id = u.id
        WHERE ${baseWhere}
        GROUP BY b.salesman_id, u.name
        ORDER BY revenue DESC
      `).all(...baseParams);

      for (const s of salesmanBreakdown) {
        const itemCount = db.prepare(`
          SELECT COALESCE(SUM(bi.quantity), 0) as items
          FROM bill_items bi
          JOIN bills b ON bi.bill_id = b.id
          WHERE b.salesman_id = ? AND ${baseWhere}
        `).get(s.salesman_id, ...baseParams);
        s.items = itemCount.items;
      }
    }

    return NextResponse.json({
      summary,
      previous_summary,
      categoryBreakdown,
      dailyTrend,
      salesmanBreakdown,
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    return NextResponse.json({ error: 'Dashboard load karne mein gadbad' }, { status: 500 });
  }
}
