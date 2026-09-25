import { NextResponse } from 'next/server';
import { getDb, generateBillNumber, updateCashDrawer } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { todayIST, daysBetweenYMD } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

const REFUND_MODES = new Set(['cash', 'upi']); // the shop never refunds to a card
const SALESMAN_RETURN_DAYS = 7;                 // "Exchange / Return sirf 7 din mein"

function round2(value) {
  return Math.round(value * 100) / 100;
}

class ReturnError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function existingReturnResponse(db, clientRequestId) {
  const existing = db.prepare(
    "SELECT id, bill_number, total FROM bills WHERE client_request_id = ? AND type = 'return'"
  ).get(clientRequestId);
  if (!existing) return null;
  return NextResponse.json({
    message: 'Return pehle hi ho chuka hai',
    bill_number: existing.bill_number,
    bill_id: existing.id,
    refund_amount: existing.total,
  }, { status: 200 });
}

// Turns the request into { line, quantity } pairs against the original bill.
// New clients send bill_item_id; old clients send category_id, which is spread
// across that category's lines that still have quantity left to return.
function resolveRequestedLines(items, lines, returnedByLine) {
  const requested = new Map(); // line id -> quantity
  const remaining = id => {
    const line = lines.find(l => l.id === id);
    return line.quantity - (returnedByLine.get(id) || 0) - (requested.get(id) || 0);
  };

  for (const [index, item] of items.entries()) {
    const quantity = Number(item?.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ReturnError(`Return item ${index + 1}: quantity galat hai`);
    }

    if (item?.bill_item_id != null) {
      const id = Number(item.bill_item_id);
      if (!lines.some(l => l.id === id)) {
        throw new ReturnError(`Return item ${index + 1}: ye item original bill mein nahi hai`);
      }
      if (quantity > remaining(id)) {
        throw new ReturnError(`Return item ${index + 1}: itne pieces return nahi ho sakte`);
      }
      requested.set(id, (requested.get(id) || 0) + quantity);
      continue;
    }

    const categoryId = Number(item?.category_id);
    const candidates = lines.filter(l => l.category_id === categoryId);
    if (candidates.length === 0) {
      throw new ReturnError(`Return item ${index + 1}: ye item original bill mein nahi hai`);
    }
    let left = quantity;
    for (const line of candidates) {
      const take = Math.min(left, remaining(line.id));
      if (take > 0) {
        requested.set(line.id, (requested.get(line.id) || 0) + take);
        left -= take;
      }
    }
    if (left > 0) {
      throw new ReturnError(`Return item ${index + 1}: itne pieces return nahi ho sakte`);
    }
  }

  return [...requested.entries()].map(([id, quantity]) => ({ line: lines.find(l => l.id === id), quantity }));
}

export async function POST(request, { params }) {
  try {
    const result = requireAuth(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { id } = await params;
    const body = await request.json().catch(() => null);
    const items = body?.items;
    const refundMode = body?.refund_mode;
    const clientRequestId = typeof body?.client_request_id === 'string' ? body.client_request_id.slice(0, 100) : null;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Kam se kam ek item select karo' }, { status: 400 });
    }
    if (items.length > 100) {
      return NextResponse.json({ error: 'Bahut zyada items' }, { status: 400 });
    }
    if (!REFUND_MODES.has(refundMode)) {
      return NextResponse.json({ error: 'Refund sirf Cash ya UPI mein ho sakta hai' }, { status: 400 });
    }

    const db = getDb();

    if (clientRequestId) {
      const already = existingReturnResponse(db, clientRequestId);
      if (already) return already;
    }

    const originalBill = db.prepare('SELECT * FROM bills WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!originalBill) {
      return NextResponse.json({ error: 'Original bill nahi mila' }, { status: 404 });
    }
    if (originalBill.type === 'return') {
      return NextResponse.json({ error: 'Return bill ka return nahi ho sakta' }, { status: 400 });
    }

    if (result.user.role !== 'admin') {
      const age = daysBetweenYMD(originalBill.created_at.slice(0, 10), todayIST());
      if (age > SALESMAN_RETURN_DAYS) {
        return NextResponse.json({ error: `${SALESMAN_RETURN_DAYS} din se purana bill hai — admin se return karwao` }, { status: 403 });
      }
    }

    const insertBill = db.prepare(`
      INSERT INTO bills (bill_number, subtotal, discount_percent, discount_amount, total, payment_mode,
                         salesman_id, notes, type, original_bill_id, client_request_id, customer_id, customer_name)
      VALUES (?, ?, 0, 0, ?, ?, ?, ?, 'return', ?, ?, ?, ?)
    `);
    const insertItem = db.prepare(
      'INSERT INTO bill_items (bill_id, category_id, mrp, quantity, amount, orig_bill_item_id) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertPayment = db.prepare('INSERT INTO bill_payments (bill_id, mode, amount) VALUES (?, ?, ?)');

    // Everything that decides the refund is read and checked inside the
    // transaction, so a concurrent void or return can't slip in between.
    const createReturn = db.transaction((billNumber) => {
      const current = db.prepare('SELECT deleted_at FROM bills WHERE id = ?').get(id);
      if (!current || current.deleted_at) throw new ReturnError('Original bill nahi mila', 404);

      const lines = db.prepare('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id').all(id);
      const returnedRows = db.prepare(`
        SELECT ri.orig_bill_item_id AS line_id, SUM(ri.quantity) AS qty
        FROM bill_items ri JOIN bills rb ON rb.id = ri.bill_id
        WHERE rb.original_bill_id = ? AND rb.type = 'return' AND rb.deleted_at IS NULL
        GROUP BY ri.orig_bill_item_id
      `).all(id);
      const returnedByLine = new Map(returnedRows.map(r => [r.line_id, r.qty]));

      const picked = resolveRequestedLines(items, lines, returnedByLine);

      // The customer paid the bill total, i.e. line prices minus any bill-level
      // discount and cash round-off. Refund each piece at that same share.
      const paidShare = originalBill.subtotal > 0 ? originalBill.total / originalBill.subtotal : 1;
      const returnLines = picked.map(({ line, quantity }) => ({
        line, quantity, amount: round2(line.amount * (quantity / line.quantity) * paidShare),
      }));

      const alreadyRefunded = db.prepare(`
        SELECT COALESCE(SUM(total), 0) AS total FROM bills
        WHERE original_bill_id = ? AND type = 'return' AND deleted_at IS NULL
      `).get(id).total;
      const refundable = round2(originalBill.total - alreadyRefunded);

      let total = round2(returnLines.reduce((s, r) => s + r.amount, 0));
      const piecesLeftAfter = lines.reduce((s, l) => s + l.quantity - (returnedByLine.get(l.id) || 0), 0)
        - returnLines.reduce((s, r) => s + r.quantity, 0);
      // Last pieces, or rounding pushing past what's left: refund exactly what
      // remains, and put the paise difference on the last line.
      if (piecesLeftAfter === 0 || total > refundable) {
        const diff = round2(refundable - total);
        returnLines[returnLines.length - 1].amount = round2(returnLines[returnLines.length - 1].amount + diff);
        total = refundable;
      }
      if (total <= 0 || returnLines.some(r => r.amount <= 0)) {
        throw new ReturnError('Is bill ka poora refund pehle hi ho chuka hai');
      }

      const res = insertBill.run(
        billNumber, total, total, refundMode, originalBill.salesman_id,
        `Return against ${originalBill.bill_number}`, id, clientRequestId,
        originalBill.customer_id, originalBill.customer_name // returns belong to the same customer
      );
      const billId = res.lastInsertRowid;
      for (const r of returnLines) {
        insertItem.run(billId, r.line.category_id, r.line.mrp, r.quantity, r.amount, r.line.id);
      }
      insertPayment.run(billId, refundMode, total);

      if (refundMode === 'cash') {
        updateCashDrawer(db, -total);
      }

      return { billId, billNumber, total };
    });

    let bill = null;
    for (let attempt = 1; !bill && attempt <= 3; attempt++) {
      try {
        bill = createReturn(generateBillNumber());
      } catch (err) {
        const message = String(err?.message || '');
        if (clientRequestId && message.includes('bills.client_request_id')) {
          return existingReturnResponse(db, clientRequestId);
        }
        if (message.includes('UNIQUE constraint failed: bills.bill_number') && attempt < 3) continue;
        throw err;
      }
    }

    return NextResponse.json({
      message: 'Return process ho gaya!',
      bill_number: bill.billNumber,
      bill_id: bill.billId,
      refund_amount: bill.total,
    }, { status: 201 });

  } catch (err) {
    if (err instanceof ReturnError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('Return bill error:', err);
    return NextResponse.json({ error: 'Return process mein gadbad' }, { status: 500 });
  }
}
