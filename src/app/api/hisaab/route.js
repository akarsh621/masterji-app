import { NextResponse } from 'next/server';
import { getDb, getCashDrawer, getPettyCashTarget } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const result = requireAdmin(request);
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
      SELECT COALESCE(SUM(CASE WHEN b.type = 'return' THEN -bi.quantity ELSE bi.quantity END), 0) as total
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

    // Cash that actually moved through the drawer today, line by line.
    // Backdated bills never touched the drawer, so they're left out here.
    const cashOf = (billFilter) => db.prepare(`
      SELECT COALESCE(SUM(bp.amount), 0) AS cash
      FROM bill_payments bp JOIN bills b ON bp.bill_id = b.id
      WHERE bp.mode = 'cash' AND ${billFilter}
    `).get().cash;
    const today = "date('now', '+5 hours', '+30 minutes')";
    const cashIn = cashOf(`b.type = 'sale' AND b.deleted_at IS NULL AND b.is_backdated = 0 AND date(b.created_at) = ${today}`);
    const cashRefunds = cashOf(`b.type = 'return' AND b.deleted_at IS NULL AND date(b.created_at) = ${today}`);

    // Bills from earlier days cancelled or corrected today change today's drawer:
    // a cancelled sale's cash goes back out, a cancelled return's refund comes
    // back in, and a correction's new cash comes in.
    const earlierCancelled = `b.deleted_at IS NOT NULL AND date(b.deleted_at) = ${today}
      AND date(b.created_at) < ${today} AND b.is_backdated = 0`;
    const cancelledSalesCash = cashOf(`b.type = 'sale' AND ${earlierCancelled}`);
    const cancelledReturnsCash = cashOf(`b.type = 'return' AND ${earlierCancelled}`);
    // A replacement's cash came in when it was saved (today), even if that
    // replacement was itself cancelled or edited again later -- that later change
    // is counted on its own as a cancelled bill.
    const correctionsCash = cashOf(`b.replaces_bill_id IN
      (SELECT id FROM bills b WHERE ${earlierCancelled})`);
    // Admin's in-place edits today of earlier days' bills: the cash difference each made.
    const inPlaceEditsCash = db.prepare(`
      SELECT COALESCE(SUM(e.cash_delta), 0) AS cash
      FROM bill_edits e JOIN bills b ON b.id = e.bill_id
      WHERE date(e.edited_at) = ${today} AND date(b.created_at) < ${today} AND b.is_backdated = 0
    `).get().cash;
    const cashAdjustment = Math.round((correctionsCash + cancelledReturnsCash - cancelledSalesCash + inPlaceEditsCash) * 100) / 100;

    return NextResponse.json({
      cash_drawer: cashDrawer,
      petty_cash_target: pettyCashTarget,
      cash_in: cashIn,
      cash_refunds: cashRefunds,
      cash_adjustment: cashAdjustment,
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
