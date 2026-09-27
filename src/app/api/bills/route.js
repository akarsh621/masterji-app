import { NextResponse } from 'next/server';
import { getDb, generateBillNumber, updateCashDrawer, getISTNow } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { isValidDate, todayIST, daysBetweenYMD, isQuarterLocked, quarterLabel, quarterLockedMessage } from '@/lib/date-utils';
import { SALESMAN_CHANGE_MINUTES } from '@/lib/limits';
import { parseBillInput, upsertCustomer } from '@/lib/bill-input';

export const dynamic = 'force-dynamic';

const VALID_FILTER_MODES = new Set(['cash', 'upi', 'card', 'mixed']);
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const BACKDATE_MAX_DAYS = 30;

class ReplaceError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
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
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request data galat hai' }, { status: 400 });
    }
    const clientRequestId = typeof body.client_request_id === 'string' ? body.client_request_id.slice(0, 100) : null;
    // Salesman's "Edit Bill": this bill replaces an existing one (cancel +
    // reissue in one step, old bill kept and linked). Admin edits in place instead
    // (PUT /api/bills/[id]).
    const replacesBillId = body.replaces_bill_id ? Number(body.replaces_bill_id) : null;

    const db = getDb();
    const input = parseBillInput(body, result.user, db);
    if (input.error) {
      return NextResponse.json({ error: input.error }, { status: input.status });
    }
    let notes = input.notes;

    const billDateInput = !replacesBillId && typeof body.bill_date === 'string' ? body.bill_date.trim() : '';
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
      if (isQuarterLocked(billDateInput, today)) {
        return NextResponse.json({ error: `${quarterLabel(billDateInput)} quarter GST filing ke liye band ho chuka hai — us date ka bill nahi ban sakta` }, { status: 400 });
      }
      if (billDateInput !== today) {
        isBackdated = true;
        backdatedCreatedAt = `${billDateInput} 12:00:00`;
        notes = notes ? `[Backdated] ${notes}` : '[Backdated]';
      }
    }

    const {
      items: normalizedItems, payments: normalizedPayments, subtotal, mrpTotal: mrp_total,
      discountAmount: discount_amount, discountPercent: discount_percent, total, paymentMode,
      cashAmount, requestedSalesmanId, customerPhone, customerName, categoryNameMap,
    } = input;
    let effectiveSalesmanId = input.salesman.id;
    let effectiveSalesmanName = input.salesman.name;

    const insertBill = db.prepare(`
      INSERT INTO bills (bill_number, subtotal, mrp_total, discount_percent, discount_amount, total, payment_mode,
                         salesman_id, notes, type, original_bill_id, is_backdated, client_request_id, replaces_bill_id,
                         customer_id, customer_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sale', NULL, ?, ?, ?, ?, ?, COALESCE(?, datetime('now', '+5 hours', '+30 minutes')))
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

      const customer = upsertCustomer(db, customerPhone, customerName, createdAt || getISTNow());
      const billResult = insertBill.run(
        billNumber, subtotal, mrp_total, discount_percent, discount_amount, total, paymentMode,
        effectiveSalesmanId, notes, billIsBackdated ? 1 : 0, clientRequestId,
        replacing ? replacing.id : null, customer.customerId, customer.customerName, createdAt
      );
      const billId = billResult.lastInsertRowid;

      for (const item of normalizedItems) {
        insertItem.run(billId, item.category_id, item.mrp, item.quantity, item.amount);
      }

      for (const p of normalizedPayments) {
        insertPayment.run(billId, p.mode, p.amount);
      }

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
        return NextResponse.json({ error: 'Jo bill edit karna tha woh nahi mila — shayad pehle hi cancel ho chuka hai' }, { status: 404 });
      }
      if (replacing.type !== 'sale') {
        return NextResponse.json({ error: 'Return bill edit nahi ho sakta' }, { status: 400 });
      }
      if (isQuarterLocked(replacing.created_at.slice(0, 10))) {
        return NextResponse.json({ error: quarterLockedMessage(replacing.created_at.slice(0, 10)) }, { status: 403 });
      }
      if (result.user.role !== 'admin') {
        const createdAt = new Date(replacing.created_at.replace(' ', 'T') + '+05:30');
        const minutesOld = (Date.now() - createdAt.getTime()) / 60000;
        if (replacing.salesman_id !== result.user.id) {
          return NextResponse.json({ error: 'Sirf apna bill edit kar sakte ho' }, { status: 403 });
        }
        if (minutesOld > SALESMAN_CHANGE_MINUTES) {
          return NextResponse.json({ error: '1 ghante se zyada ho gaya, admin se bolo' }, { status: 403 });
        }
      }
      const activeReturn = db.prepare(
        "SELECT bill_number FROM bills WHERE original_bill_id = ? AND type = 'return' AND deleted_at IS NULL"
      ).get(replacing.id);
      if (activeReturn) {
        return NextResponse.json({ error: `Is bill ka return (${activeReturn.bill_number}) hua hai — ye bill edit nahi ho sakta` }, { status: 409 });
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
      customer_phone: customerPhone || null,
      customer_name: customerName || null,
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
    // Search across all dates: bill number (MJF-0231 or 231), customer phone,
    // customer name, or exact amount.
    const q = (searchParams.get('q') || '').trim().slice(0, 50);
    const customerIdFilter = searchParams.get('customer_id');
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

    if (customerIdFilter) {
      const cid = Number(customerIdFilter);
      if (!Number.isInteger(cid) || cid <= 0) {
        return NextResponse.json({ error: 'Customer filter invalid hai' }, { status: 400 });
      }
      where.push('b.customer_id = ?');
      params.push(cid);
    }

    if (q) {
      const digits = q.replace(/\D/g, '');
      const ors = ['b.bill_number LIKE ?', 'b.customer_name LIKE ?', 'c.name LIKE ?'];
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      if (digits.length >= 3) {
        ors.push('c.phone LIKE ?');
        params.push(`%${digits}%`);
      }
      const amount = Number(q.replace(/[₹,\s]/g, ''));
      if (q.replace(/[₹,\s]/g, '') !== '' && Number.isFinite(amount)) {
        ors.push('ABS(b.total - ?) < 0.01');
        params.push(amount);
      }
      where.push(`(${ors.join(' OR ')})`);
    } else {
      // Date range only applies when not searching (search covers all dates).
      if (from) {
        where.push('b.created_at >= ?');
        params.push(`${from} 00:00:00`);
      }
      if (to) {
        where.push('b.created_at <= ?');
        params.push(to + ' 23:59:59');
      }
    }
    if (payment_mode) {
      where.push('b.payment_mode = ?');
      params.push(payment_mode);
    }

    const whereClause = where.join(' AND ');

    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM bills b LEFT JOIN customers c ON c.id = b.customer_id WHERE ${whereClause}`
    ).get(...params);

    const bills = db.prepare(`
      SELECT b.*, u.name as salesman_name, c.phone AS customer_phone,
             (SELECT ob.bill_number FROM bills ob WHERE ob.id = b.original_bill_id) AS original_bill_number,
             (SELECT rb.bill_number FROM bills rb WHERE rb.id = b.replaces_bill_id) AS replaces_bill_number
      FROM bills b
      JOIN users u ON b.salesman_id = u.id
      LEFT JOIN customers c ON c.id = b.customer_id
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
