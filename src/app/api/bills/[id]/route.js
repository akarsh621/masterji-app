import { NextResponse } from 'next/server';
import { getDb, getISTNow, updateCashDrawer } from '@/lib/db';
import { requireAuth, requireAdmin } from '@/lib/auth';
import { SALESMAN_CHANGE_MINUTES } from '@/lib/limits';
import { parseBillInput, upsertCustomer, round2 } from '@/lib/bill-input';
import { isQuarterLocked, quarterLockedMessage } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

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

    // Bills in a quarter already closed for GST filing never change.
    if (isQuarterLocked(bill.created_at.slice(0, 10))) {
      return NextResponse.json({ error: quarterLockedMessage(bill.created_at.slice(0, 10)) }, { status: 403 });
    }

    if (result.user.role === 'salesman') {
      if (bill.salesman_id !== result.user.id) {
        return NextResponse.json({ error: 'Sirf apna bill cancel kar sakte ho' }, { status: 403 });
      }
      const createdAt = new Date(bill.created_at.replace(' ', 'T') + '+05:30');
      const minutesOld = (Date.now() - createdAt.getTime()) / 60000;
      if (minutesOld > SALESMAN_CHANGE_MINUTES) {
        return NextResponse.json({ error: '1 ghante se zyada ho gaya, admin se bolo' }, { status: 403 });
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
      // A sale with an active return can't be cancelled (the refund would stay
      // counted). Checked inside the transaction so a return saved at the same
      // moment can't slip past.
      if (bill.type === 'sale') {
        const activeReturn = db.prepare(
          "SELECT bill_number FROM bills WHERE original_bill_id = ? AND type = 'return' AND deleted_at IS NULL"
        ).get(id);
        if (activeReturn) return { blockedBy: activeReturn.bill_number };
      }

      // Re-checked inside the transaction so two voids can't both reverse cash.
      const changed = db.prepare('UPDATE bills SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(getISTNow(), id);
      if (changed.changes === 0) return false;

      // Backdated bills never added cash to the drawer, so voiding one must not
      // take any out.
      if (!bill.is_backdated) {
        const cashAmount = payments
          .filter(p => p.mode === 'cash')
          .reduce((s, p) => s + p.amount, 0);
        if (cashAmount > 0) {
          updateCashDrawer(db, bill.type === 'return' ? cashAmount : -cashAmount);
        }
      }

      // A cancelled bill must never come out of the printer.
      db.prepare("UPDATE print_queue SET status = 'failed' WHERE bill_id = ? AND status = 'pending'").run(id);
      return true;
    });

    const outcome = voidBill();
    if (outcome && outcome.blockedBy) {
      return NextResponse.json(
        { error: `Is bill ka return (${outcome.blockedBy}) hua hai — pehle woh return cancel karo` },
        { status: 409 }
      );
    }
    if (!outcome) {
      return NextResponse.json({ error: 'Bill pehle hi cancel ho chuka hai' }, { status: 404 });
    }

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

class EditError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Admin's in-place edit: the bill keeps its number, date and backdated status;
// everything else is replaced. Silent by owner decision (no old values kept),
// but money-safe: the same checks as a new bill, one transaction, and the drawer
// moves only by the cash difference (never for backdated bills).
export async function PUT(request, { params }) {
  try {
    const result = requireAdmin(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { id } = await params;
    const billId = Number(id);
    if (!Number.isInteger(billId) || billId <= 0) {
      return NextResponse.json({ error: 'Bill ID galat hai' }, { status: 400 });
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request data galat hai' }, { status: 400 });
    }

    const db = getDb();
    const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND deleted_at IS NULL').get(billId);
    if (!bill) {
      return NextResponse.json({ error: 'Bill nahi mila — shayad cancel ho chuka hai' }, { status: 404 });
    }
    if (bill.type !== 'sale') {
      return NextResponse.json({ error: 'Return bill edit nahi ho sakta' }, { status: 400 });
    }
    if (isQuarterLocked(bill.created_at.slice(0, 10))) {
      return NextResponse.json({ error: quarterLockedMessage(bill.created_at.slice(0, 10)) }, { status: 403 });
    }

    const input = parseBillInput(body, result.user, db);
    if (input.error) {
      return NextResponse.json({ error: input.error }, { status: input.status });
    }
    // Keeps the bill's salesman (even if since deactivated) unless another is named.
    if (!input.requestedSalesmanId) {
      const original = db.prepare('SELECT id, name FROM users WHERE id = ?').get(bill.salesman_id);
      input.salesman = { id: original.id, name: original.name };
    }
    // A backdated bill keeps its marker on the note.
    let notes = input.notes;
    if (bill.is_backdated && !notes.startsWith('[Backdated]')) {
      notes = notes ? `[Backdated] ${notes}` : '[Backdated]';
    }

    const now = getISTNow();
    const editBill = db.transaction(() => {
      // Re-checked inside the transaction so a cancel or return at the same
      // moment can't slip in between.
      const current = db.prepare('SELECT deleted_at FROM bills WHERE id = ?').get(billId);
      if (!current || current.deleted_at) throw new EditError('Bill nahi mila — shayad cancel ho chuka hai', 404);
      const activeReturn = db.prepare(
        "SELECT bill_number FROM bills WHERE original_bill_id = ? AND type = 'return' AND deleted_at IS NULL"
      ).get(billId);
      if (activeReturn) {
        throw new EditError(`Is bill ka return (${activeReturn.bill_number}) hua hai — ye bill edit nahi ho sakta`, 409);
      }

      const oldCash = db.prepare(
        "SELECT COALESCE(SUM(amount), 0) AS cash FROM bill_payments WHERE bill_id = ? AND mode = 'cash'"
      ).get(billId).cash;

      // Cancelled returns may still point at the old lines; unlink them so the
      // old lines can go (active returns already block the edit).
      db.prepare(`UPDATE bill_items SET orig_bill_item_id = NULL
                  WHERE orig_bill_item_id IN (SELECT id FROM bill_items WHERE bill_id = ?)`).run(billId);
      db.prepare('DELETE FROM bill_items WHERE bill_id = ?').run(billId);
      db.prepare('DELETE FROM bill_payments WHERE bill_id = ?').run(billId);

      const insertItem = db.prepare('INSERT INTO bill_items (bill_id, category_id, mrp, quantity, amount) VALUES (?, ?, ?, ?, ?)');
      for (const item of input.items) insertItem.run(billId, item.category_id, item.mrp, item.quantity, item.amount);
      const insertPayment = db.prepare('INSERT INTO bill_payments (bill_id, mode, amount) VALUES (?, ?, ?)');
      for (const p of input.payments) insertPayment.run(billId, p.mode, p.amount);

      const customer = upsertCustomer(db, input.customerPhone, input.customerName, bill.created_at);
      db.prepare(`UPDATE bills SET subtotal = ?, mrp_total = ?, discount_percent = ?, discount_amount = ?, total = ?,
                    payment_mode = ?, salesman_id = ?, notes = ?, customer_id = ?, customer_name = ?,
                    edited_at = ?, edited_by = ?
                  WHERE id = ?`).run(
        input.subtotal, input.mrpTotal, input.discountPercent, input.discountAmount, input.total,
        input.paymentMode, input.salesman.id, notes, customer.customerId, customer.customerName,
        now, result.user.id, billId
      );

      const cashDelta = bill.is_backdated ? 0 : round2(input.cashAmount - oldCash);
      if (cashDelta !== 0) updateCashDrawer(db, cashDelta);
      db.prepare('INSERT INTO bill_edits (bill_id, edited_at, edited_by, cash_delta) VALUES (?, ?, ?, ?)')
        .run(billId, now, result.user.id, cashDelta);
    });
    editBill();

    return NextResponse.json({
      message: 'Bill update ho gaya',
      edited_in_place: true,
      bill_number: bill.bill_number,
      bill_id: billId,
      total: input.total,
      subtotal: input.subtotal,
      mrp_total: input.mrpTotal,
      discount_percent: input.discountPercent,
      discount_amount: input.discountAmount,
      payment_mode: input.paymentMode,
      items: input.items.map(item => ({
        category_id: item.category_id,
        category_name: input.categoryNameMap[item.category_id] || 'Item',
        mrp: item.mrp,
        quantity: item.quantity,
        amount: item.amount,
      })),
      payments: input.payments,
      salesman_name: input.salesman.name,
      notes: notes || null,
      created_at: bill.created_at,
      is_backdated: !!bill.is_backdated,
      customer_phone: input.customerPhone || null,
      customer_name: input.customerName || null,
    });
  } catch (err) {
    if (err instanceof EditError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('Edit bill error:', err);
    return NextResponse.json({ error: 'Bill edit karne mein gadbad' }, { status: 500 });
  }
}
