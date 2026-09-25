import { NextResponse } from 'next/server';
import { getDb, generateBillNumber, updateCashDrawer, getISTNow } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { isValidDate, todayIST, daysBetweenYMD } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

const VALID_PAYMENT_MODES = new Set(['cash', 'upi', 'card']);
const VALID_FILTER_MODES = new Set(['cash', 'upi', 'card', 'mixed']);
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const BACKDATE_MAX_DAYS = 30;
const SALESMAN_EDIT_MINUTES = 15; // same window as cancelling a bill

class ReplaceError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function isDateOnly(value) {
  return DATE_ONLY_REGEX.test(value);
}

export async function POST(request) {
  try {
    const result = requireAuth(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const body = await request.json().catch(() => null);
    const items = body?.items;
    const payments = body?.payments;
    const discount_percent_input = Number(body?.discount_percent ?? 0);
    // When the client sends discount_amount (even 0) it is the source of truth;
    // the percent is only a fallback for clients that send nothing else.
    const hasDiscountAmount = typeof body?.discount_amount === 'number';
    const discount_amount_input = Number(body?.discount_amount ?? 0);
    const clientRequestId = typeof body?.client_request_id === 'string' ? body.client_request_id.slice(0, 100) : null;
    // "Bill badlo": this bill replaces an existing one (cancel + reissue in one step).
    const replacesBillId = body?.replaces_bill_id ? Number(body.replaces_bill_id) : null;
    let notes = typeof body?.notes === 'string' ? body.notes.trim() : '';
    const billType = 'sale';
    const originalBillId = null;

    const billDateInput = !replacesBillId && typeof body?.bill_date === 'string' ? body.bill_date.trim() : '';
    const today = todayIST();
    let isBackdated = false;
    let backdatedCreatedAt = null;
    if (billDateInput) {
      if (result.user.role !== 'admin') {
        return NextResponse.json({ error: 'Sirf admin backdated bill bana sakta hai' }, { status: 403 });
      }
      if (!isValidDate(billDateInput)) {
        return NextResponse.json({ error: 'Bill date format galat hai (YYYY-MM-DD)' }, { status: 400 });
      }
      if (billDateInput > today) {
        return NextResponse.json({ error: 'Bill date future mein nahi ho sakti' }, { status: 400 });
      }
      const daysOld = daysBetweenYMD(billDateInput, today);
      if (daysOld > BACKDATE_MAX_DAYS) {
        return NextResponse.json({ error: `Backdate ${BACKDATE_MAX_DAYS} din se purana nahi ho sakta` }, { status: 400 });
      }
      if (billDateInput !== today) {
        isBackdated = true;
        backdatedCreatedAt = `${billDateInput} 12:00:00`;
        notes = notes ? `[Backdated] ${notes}` : '[Backdated]';
      }
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Kam se kam ek item daalo' }, { status: 400 });
    }

    if (!payments || !Array.isArray(payments) || payments.length === 0) {
      return NextResponse.json({ error: 'Kam se kam ek payment mode daalo' }, { status: 400 });
    }

    if (items.length > 100 || payments.length > 3) {
      return NextResponse.json({ error: 'Bill mein bahut zyada items ya payments hain' }, { status: 400 });
    }
    if (notes.length > 500) {
      return NextResponse.json({ error: 'Note 500 characters se chhota rakho' }, { status: 400 });
    }

    for (const [i, p] of payments.entries()) {
      if (!VALID_PAYMENT_MODES.has(p?.mode)) {
        return NextResponse.json({ error: `Payment ${i + 1}: mode cash, upi ya card hona chahiye` }, { status: 400 });
      }
      const amt = Number(p?.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return NextResponse.json({ error: `Payment ${i + 1}: amount galat hai` }, { status: 400 });
      }
    }

    if (!Number.isFinite(discount_amount_input) || discount_amount_input < 0) {
      return NextResponse.json({ error: 'Discount amount galat hai' }, { status: 400 });
    }
    if (!Number.isFinite(discount_percent_input) || discount_percent_input < 0 || discount_percent_input > 100) {
      return NextResponse.json({ error: 'Discount 0-100% ke beech hona chahiye' }, { status: 400 });
    }

    const normalizedItems = [];
    for (const [index, item] of items.entries()) {
      const categoryId = Number(item?.category_id);
      const quantity = Number(item?.quantity);
      const amount = Number(item?.amount);
      const mrp = item?.mrp != null ? Number(item.mrp) : null;

      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return NextResponse.json({ error: `Item ${index + 1}: category galat hai` }, { status: 400 });
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return NextResponse.json({ error: `Item ${index + 1}: quantity galat hai` }, { status: 400 });
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: `Item ${index + 1}: amount galat hai` }, { status: 400 });
      }
      if (mrp !== null && (!Number.isFinite(mrp) || mrp <= 0)) {
        return NextResponse.json({ error: `Item ${index + 1}: MRP galat hai` }, { status: 400 });
      }
      if (mrp !== null && amount > mrp * quantity + 0.01) {
        return NextResponse.json({ error: `Item ${index + 1}: amount MRP se zyada nahi ho sakta` }, { status: 400 });
      }

      normalizedItems.push({
        category_id: categoryId,
        mrp: mrp ? round2(mrp) : null,
        quantity,
        amount: round2(amount),
      });
    }

    const subtotal = round2(normalizedItems.reduce((sum, item) => sum + item.amount, 0));
    const mrp_total = round2(normalizedItems.reduce((sum, item) => sum + ((item.mrp || (item.amount / item.quantity)) * item.quantity), 0));
    const rawDiscountAmt = hasDiscountAmount
      ? discount_amount_input
      : round2(subtotal * (discount_percent_input / 100));
    const discount_amount = round2(Math.min(rawDiscountAmt, subtotal));
    const total = round2(subtotal - discount_amount);
    // Stored percent is always derived from the amount, so the two never disagree.
    const discount_percent = subtotal > 0 ? round2((discount_amount / subtotal) * 100) : 0;

    if (total <= 0) {
      return NextResponse.json({ error: 'Total amount 0 se zyada hona chahiye' }, { status: 400 });
    }

    const normalizedPayments = payments.map(p => ({ mode: p.mode, amount: round2(Number(p.amount)) }));
    const paymentSum = round2(normalizedPayments.reduce((s, p) => s + p.amount, 0));
    if (Math.abs(paymentSum - total) > 0.01) {
      return NextResponse.json({ error: `Payment total (₹${paymentSum}) bill total (₹${total}) se match nahi karta` }, { status: 400 });
    }

    const modes = [...new Set(normalizedPayments.map(p => p.mode))];
    const paymentMode = modes.length === 1 ? modes[0] : 'mixed';

    const db = getDb();

    let effectiveSalesmanId = result.user.id;
    let effectiveSalesmanName = result.user.name;
    const requestedSalesmanId = body?.salesman_id ? Number(body.salesman_id) : null;
    if (requestedSalesmanId) {
      const targetUser = db.prepare('SELECT id, name, active FROM users WHERE id = ?').get(requestedSalesmanId);
      if (!targetUser || !targetUser.active) {
        return NextResponse.json({ error: 'Selected salesman invalid hai' }, { status: 400 });
      }
      effectiveSalesmanId = targetUser.id;
      effectiveSalesmanName = targetUser.name;
    }

    const uniqueCategoryIds = [...new Set(normalizedItems.map(item => item.category_id))];
    const placeholders = uniqueCategoryIds.map(() => '?').join(',');
    const existingCategories = db.prepare(
      `SELECT id, name FROM categories WHERE id IN (${placeholders})`
    ).all(...uniqueCategoryIds);
    if (existingCategories.length !== uniqueCategoryIds.length) {
      return NextResponse.json({ error: 'Ek ya zyada category invalid hai' }, { status: 400 });
    }
    const categoryNameMap = Object.fromEntries(existingCategories.map(c => [c.id, c.name]));

    const insertBill = db.prepare(`
      INSERT INTO bills (bill_number, subtotal, mrp_total, discount_percent, discount_amount, total, payment_mode,
                         salesman_id, notes, type, original_bill_id, is_backdated, client_request_id, replaces_bill_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now', '+5 hours', '+30 minutes')))
    `);

    const insertItem = db.prepare(`
      INSERT INTO bill_items (bill_id, category_id, mrp, quantity, amount)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertPayment = db.prepare(`
      INSERT INTO bill_payments (bill_id, mode, amount)
      VALUES (?, ?, ?)
    `);

    let replacing = null; // set below, after the duplicate-request check

    const createBill = db.transaction((billNumber) => {
      if (replacing) {
        // Cancel the old bill in the same transaction; if someone cancelled it
        // meanwhile, nothing is saved.
        const cancelled = db.prepare('UPDATE bills SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
          .run(getISTNow(), replacing.id);
        if (cancelled.changes === 0) throw new ReplaceError('Ye bill pehle hi cancel ho chuka hai', 409);
        db.prepare("UPDATE print_queue SET status = 'failed' WHERE bill_id = ? AND status = 'pending'").run(replacing.id);
      }

      // A correction keeps the original bill's date and backdated status.
      const billIsBackdated = replacing ? !!replacing.is_backdated : isBackdated;
      const createdAt = replacing ? replacing.created_at : (isBackdated ? backdatedCreatedAt : null);
      const billResult = insertBill.run(
        billNumber, subtotal, mrp_total, discount_percent, discount_amount, total, paymentMode,
        effectiveSalesmanId, notes, billType, originalBillId, billIsBackdated ? 1 : 0, clientRequestId,
        replacing ? replacing.id : null, createdAt
      );
      const billId = billResult.lastInsertRowid;

      for (const item of normalizedItems) {
        insertItem.run(billId, item.category_id, item.mrp, item.quantity, item.amount);
      }

      for (const p of normalizedPayments) {
        insertPayment.run(billId, p.mode, p.amount);
      }

      const cashAmount = normalizedPayments
        .filter(p => p.mode === 'cash')
        .reduce((s, p) => s + p.amount, 0);
      if (replacing) {
        // Only the difference moves the drawer (₹960 cash corrected to ₹900 cash
        // is -₹60), and only if the original bill ever touched the drawer.
        if (!replacing.is_backdated) {
          const oldCash = db.prepare(
            "SELECT COALESCE(SUM(amount), 0) AS cash FROM bill_payments WHERE bill_id = ? AND mode = 'cash'"
          ).get(replacing.id).cash;
          const delta = Math.round((cashAmount - oldCash) * 100) / 100;
          if (delta !== 0) updateCashDrawer(db, delta);
        }
      } else if (!isBackdated && cashAmount > 0) {
        updateCashDrawer(db, cashAmount);
      }

      return { billId, billNumber };
    });

    // A retry of a request that already succeeded (e.g. the response was lost
    // on a bad connection) returns the existing bill instead of a duplicate.
    const findExisting = () => clientRequestId
      ? db.prepare("SELECT id, bill_number, total FROM bills WHERE client_request_id = ? AND type = 'sale'").get(clientRequestId)
      : null;
    const existingResponse = (existing) => NextResponse.json({
      message: 'Bill pehle hi ban chuka hai',
      bill_number: existing.bill_number,
      bill_id: existing.id,
      total: existing.total,
      duplicate: true,
    }, { status: 200 });

    const already = findExisting();
    if (already) return existingResponse(already);

    if (replacesBillId) {
      replacing = db.prepare('SELECT * FROM bills WHERE id = ?').get(replacesBillId);
      if (!replacing || replacing.deleted_at) {
        return NextResponse.json({ error: 'Jo bill badalna tha woh nahi mila — shayad pehle hi cancel ho chuka hai' }, { status: 404 });
      }
      if (replacing.type !== 'sale') {
        return NextResponse.json({ error: 'Return bill badla nahi ja sakta' }, { status: 400 });
      }
      if (result.user.role !== 'admin') {
        const createdAt = new Date(replacing.created_at.replace(' ', 'T') + '+05:30');
        const minutesOld = (Date.now() - createdAt.getTime()) / 60000;
        if (replacing.salesman_id !== result.user.id) {
          return NextResponse.json({ error: 'Sirf apna bill badal sakte ho' }, { status: 403 });
        }
        if (minutesOld > SALESMAN_EDIT_MINUTES) {
          return NextResponse.json({ error: `${SALESMAN_EDIT_MINUTES} minute se zyada ho gaye, admin se bolo` }, { status: 403 });
        }
      }
      const activeReturn = db.prepare(
        "SELECT bill_number FROM bills WHERE original_bill_id = ? AND type = 'return' AND deleted_at IS NULL"
      ).get(replacing.id);
      if (activeReturn) {
        return NextResponse.json({ error: `Is bill ka return (${activeReturn.bill_number}) hua hai — ye bill badla nahi ja sakta` }, { status: 409 });
      }
      // Keeps the original salesman unless the bill explicitly names another.
      if (!requestedSalesmanId) {
        const original = db.prepare('SELECT id, name FROM users WHERE id = ?').get(replacing.salesman_id);
        if (original) {
          effectiveSalesmanId = original.id;
          effectiveSalesmanName = original.name;
        }
      }
    }

    let bill = null;
    let attempts = 0;
    while (!bill && attempts < 3) {
      attempts += 1;
      try {
        bill = createBill(generateBillNumber());
      } catch (err) {
        const message = String(err?.message || '');
        if (message.includes('bills.client_request_id')) {
          const existing = findExisting();
          if (existing) return existingResponse(existing);
        }
        if (message.includes('UNIQUE constraint failed: bills.bill_number') && attempts < 3) {
          continue;
        }
        throw err;
      }
    }

    if (!bill) {
      return NextResponse.json({ error: 'Bill number generate nahi hua, dubara try karo' }, { status: 500 });
    }

    const istNow = new Date().toLocaleString('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).replace(',', '');

    return NextResponse.json({
      message: 'Bill ban gaya!',
      bill_number: bill.billNumber,
      bill_id: bill.billId,
      total,
      subtotal,
      mrp_total,
      discount_percent: discount_percent,
      discount_amount,
      payment_mode: paymentMode,
      items: normalizedItems.map(item => ({
        category_id: item.category_id,
        category_name: categoryNameMap[item.category_id] || 'Item',
        mrp: item.mrp,
        quantity: item.quantity,
        amount: item.amount,
      })),
      payments: normalizedPayments,
      salesman_name: effectiveSalesmanName,
      notes: notes || null,
      created_at: replacing ? replacing.created_at : (isBackdated ? backdatedCreatedAt : istNow),
      is_backdated: replacing ? !!replacing.is_backdated : isBackdated,
      replaces_bill_number: replacing ? replacing.bill_number : null,
      bill_date: isBackdated ? billDateInput : null,
    }, { status: 201 });

  } catch (err) {
    if (err instanceof ReplaceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('Create bill error:', err);
    const message = String(err?.message || '');
    if (message.includes('CHECK constraint failed') || message.includes('FOREIGN KEY constraint failed')) {
      return NextResponse.json({ error: 'Bill data invalid hai' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Bill banane mein gadbad' }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    const result = requireAuth(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { searchParams } = new URL(request.url);
    const pageRaw = parseInt(searchParams.get('page') || '1', 10);
    const limitRaw = parseInt(searchParams.get('limit') || '50', 10);
    const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const salesman_id = searchParams.get('salesman_id');
    const payment_mode = searchParams.get('payment_mode');
    const offset = (page - 1) * limit;

    if (from && !isDateOnly(from)) {
      return NextResponse.json({ error: 'From date format galat hai (YYYY-MM-DD)' }, { status: 400 });
    }
    if (to && !isDateOnly(to)) {
      return NextResponse.json({ error: 'To date format galat hai (YYYY-MM-DD)' }, { status: 400 });
    }
    if (from && to && from > to) {
      return NextResponse.json({ error: 'From date, To date se chhoti honi chahiye' }, { status: 400 });
    }
    if (payment_mode && !VALID_FILTER_MODES.has(payment_mode)) {
      return NextResponse.json({ error: 'Payment mode galat hai' }, { status: 400 });
    }

    const db = getDb();

    let where = ['b.deleted_at IS NULL'];
    let params = [];

    if (salesman_id) {
      const salesmanIdNumber = Number(salesman_id);
      if (!Number.isInteger(salesmanIdNumber) || salesmanIdNumber <= 0) {
        return NextResponse.json({ error: 'Salesman filter invalid hai' }, { status: 400 });
      }
      where.push('b.salesman_id = ?');
      params.push(salesmanIdNumber);
    }

    if (from) {
      where.push('b.created_at >= ?');
      params.push(`${from} 00:00:00`);
    }
    if (to) {
      where.push('b.created_at <= ?');
      params.push(to + ' 23:59:59');
    }
    if (payment_mode) {
      where.push('b.payment_mode = ?');
      params.push(payment_mode);
    }

    const whereClause = where.join(' AND ');

    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM bills b WHERE ${whereClause}`
    ).get(...params);

    const bills = db.prepare(`
      SELECT b.*, u.name as salesman_name,
             (SELECT ob.bill_number FROM bills ob WHERE ob.id = b.original_bill_id) AS original_bill_number,
             (SELECT rb.bill_number FROM bills rb WHERE rb.id = b.replaces_bill_id) AS replaces_bill_number
      FROM bills b
      JOIN users u ON b.salesman_id = u.id
      WHERE ${whereClause}
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const billIds = bills.map(b => b.id);
    let itemsByBill = {};
    let paymentsByBill = {};

    if (billIds.length > 0) {
      const ph = billIds.map(() => '?').join(',');
      // returned_qty: pieces of each sale line already returned (active returns only),
      // so Bill Book can show how many are still returnable.
      const allItems = db.prepare(`
        SELECT bi.*, c.name as category_name, c.group_name,
               COALESCE((
                 SELECT SUM(ri.quantity) FROM bill_items ri
                 JOIN bills rb ON rb.id = ri.bill_id
                 WHERE ri.orig_bill_item_id = bi.id AND rb.type = 'return' AND rb.deleted_at IS NULL
               ), 0) AS returned_qty
        FROM bill_items bi
        JOIN categories c ON bi.category_id = c.id
        WHERE bi.bill_id IN (${ph})
      `).all(...billIds);

      for (const item of allItems) {
        if (!itemsByBill[item.bill_id]) itemsByBill[item.bill_id] = [];
        itemsByBill[item.bill_id].push(item);
      }

      const allPayments = db.prepare(`
        SELECT * FROM bill_payments WHERE bill_id IN (${ph})
      `).all(...billIds);

      for (const p of allPayments) {
        if (!paymentsByBill[p.bill_id]) paymentsByBill[p.bill_id] = [];
        paymentsByBill[p.bill_id].push(p);
      }
    }

    const billsWithDetails = bills.map(b => ({
      ...b,
      items: itemsByBill[b.id] || [],
      payments: paymentsByBill[b.id] || [],
    }));

    return NextResponse.json({
      bills: billsWithDetails,
      pagination: {
        page,
        limit,
        total: countRow.total,
        pages: Math.ceil(countRow.total / limit),
      },
    });

  } catch (err) {
    console.error('List bills error:', err);
    return NextResponse.json({ error: 'Bills load karne mein gadbad' }, { status: 500 });
  }
}
