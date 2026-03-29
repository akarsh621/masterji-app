import { NextResponse } from 'next/server';
import { getDb, generateBillNumber, updateCashDrawer } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

const VALID_PAYMENT_MODES = new Set(['cash', 'upi', 'card']);
const VALID_FILTER_MODES = new Set(['cash', 'upi', 'card', 'mixed']);
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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

    const body = await request.json();
    const items = body?.items;
    const payments = body?.payments;
    const discount_percent = Number(body?.discount_percent ?? 0);
    const discount_amount_input = Number(body?.discount_amount ?? 0);
    const mrp_total_input = Number(body?.mrp_total ?? 0);
    const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';
    const billType = 'sale';
    const originalBillId = null;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Kam se kam ek item daalo' }, { status: 400 });
    }

    if (!payments || !Array.isArray(payments) || payments.length === 0) {
      return NextResponse.json({ error: 'Kam se kam ek payment mode daalo' }, { status: 400 });
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

    if (!Number.isFinite(discount_percent) || discount_percent < 0 || discount_percent > 100) {
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
    const rawDiscountAmt = discount_amount_input > 0
      ? discount_amount_input
      : round2(subtotal * (discount_percent / 100));
    const discount_amount = round2(Math.min(rawDiscountAmt, subtotal));
    const total = round2(subtotal - discount_amount);

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
    if (requestedSalesmanId && result.user.role === 'admin') {
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
      INSERT INTO bills (bill_number, subtotal, mrp_total, discount_percent, discount_amount, total, payment_mode, salesman_id, notes, type, original_bill_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertItem = db.prepare(`
      INSERT INTO bill_items (bill_id, category_id, mrp, quantity, amount)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertPayment = db.prepare(`
      INSERT INTO bill_payments (bill_id, mode, amount)
      VALUES (?, ?, ?)
    `);

    const createBill = db.transaction((billNumber) => {
      const billResult = insertBill.run(
        billNumber, subtotal, mrp_total, discount_percent, discount_amount, total, paymentMode, effectiveSalesmanId, notes, billType, originalBillId
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
      if (cashAmount > 0) {
        updateCashDrawer(db, billType === 'return' ? -cashAmount : cashAmount);
      }

      return { billId, billNumber };
    });

    let bill = null;
    let attempts = 0;
    while (!bill && attempts < 3) {
      attempts += 1;
      try {
        bill = createBill(generateBillNumber());
      } catch (err) {
        const message = String(err?.message || '');
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
      created_at: istNow,
    }, { status: 201 });

  } catch (err) {
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

    if (result.user.role === 'salesman') {
      where.push('b.salesman_id = ?');
      params.push(result.user.id);
    } else if (salesman_id) {
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
      SELECT b.*, u.name as salesman_name
      FROM bills b
      JOIN users u ON b.salesman_id = u.id
      WHERE ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const billIds = bills.map(b => b.id);
    let itemsByBill = {};
    let paymentsByBill = {};

    if (billIds.length > 0) {
      const ph = billIds.map(() => '?').join(',');
      const allItems = db.prepare(`
        SELECT bi.*, c.name as category_name, c.group_name
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
