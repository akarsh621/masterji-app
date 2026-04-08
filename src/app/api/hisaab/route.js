import { NextResponse } from 'next/server';
import { getDb, getCashDrawer, getPettyCashTarget } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export async function GET(request) {
  try {
    const result = requireAuth(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const db = getDb();
    const dateWhere = "date(b.created_at) = date('now', '+5 hours', '+30 minutes')";

    const cashDrawer = getCashDrawer(db);

    const salesSummary = db.prepare(`
      SELECT
        COUNT(*) as total_bills,
        COALESCE(SUM(CASE WHEN b.type = 'sale' THEN 1 ELSE 0 END), 0) as sale_count,
        COALESCE(SUM(CASE WHEN b.type = 'return' THEN 1 ELSE 0 END), 0) as return_count,
        COALESCE(SUM(CASE WHEN b.type = 'return' THEN -b.total ELSE b.total END), 0) as net_revenue,
        COALESCE(SUM(CASE WHEN b.type = 'sale' THEN
          CASE WHEN b.mrp_total > 0 THEN (b.mrp_total - b.total) ELSE b.discount_amount END
        ELSE 0 END), 0) as total_discount
      FROM bills b
      WHERE b.deleted_at IS NULL AND ${dateWhere}
    `).get();

    const totalItems = db.prepare(`
      SELECT COALESCE(SUM(bi.quantity), 0) as total
      FROM bill_items bi JOIN bills b ON bi.bill_id = b.id
      WHERE b.deleted_at IS NULL AND ${dateWhere}
    `).get();

    const paymentSplit = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN bp.mode = 'cash' THEN CASE WHEN b.type = 'return' THEN -bp.amount ELSE bp.amount END ELSE 0 END), 0) as cash_total,
        COALESCE(SUM(CASE WHEN bp.mode = 'upi' THEN CASE WHEN b.type = 'return' THEN -bp.amount ELSE bp.amount END ELSE 0 END), 0) as upi_total,
        COALESCE(SUM(CASE WHEN bp.mode = 'card' THEN CASE WHEN b.type = 'return' THEN -bp.amount ELSE bp.amount END ELSE 0 END), 0) as card_total
      FROM bill_payments bp
      JOIN bills b ON bp.bill_id = b.id
      WHERE b.deleted_at IS NULL AND ${dateWhere}
    `).get();

    const cashOutSummary = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) as total,
        COALESCE(SUM(CASE WHEN reason = 'expense' THEN amount ELSE 0 END), 0) as expense_total,
        COALESCE(SUM(CASE WHEN reason = 'supplier' THEN amount ELSE 0 END), 0) as supplier_total,
        COALESCE(SUM(CASE WHEN reason = 'owner' THEN amount ELSE 0 END), 0) as owner_total,
        COALESCE(SUM(CASE WHEN reason = 'other' THEN amount ELSE 0 END), 0) as other_total,
        COALESCE(SUM(CASE WHEN reason = 'sweep' THEN amount ELSE 0 END), 0) as sweep_total,
        COALESCE(SUM(CASE WHEN reason = 'manual' THEN amount ELSE 0 END), 0) as manual_total
      FROM cash_out
      WHERE date(created_at) = date('now', '+5 hours', '+30 minutes')
    `).get();

    const pettyCashTarget = getPettyCashTarget(db);

    const cashOutEntries = db.prepare(`
      SELECT co.*, u.name as recorded_by_name
      FROM cash_out co
      JOIN users u ON co.recorded_by = u.id
      WHERE date(co.created_at) = date('now', '+5 hours', '+30 minutes')
      ORDER BY co.created_at DESC
    `).all();

    const cashIn = Math.max(0, paymentSplit.cash_total);
    const cashRefunds = paymentSplit.cash_total < 0 ? Math.abs(paymentSplit.cash_total) : 0;

    return NextResponse.json({
      cash_drawer: cashDrawer,
      petty_cash_target: pettyCashTarget,
      cash_in: cashIn,
      cash_refunds: cashRefunds,
      cash_out: cashOutSummary,
      cash_out_entries: cashOutEntries,
      payment_split: paymentSplit,
      sales: {
        ...salesSummary,
        total_items: totalItems.total,
        net_revenue: salesSummary.net_revenue,
      },
    });
  } catch (err) {
    console.error('Hisaab error:', err);
    return NextResponse.json({ error: 'Hisaab load karne mein gadbad' }, { status: 500 });
  }
}
