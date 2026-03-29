import { NextResponse } from 'next/server';
import { getDb, generateBillNumber, updateCashDrawer } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

function round2(value) {
  return Math.round(value * 100) / 100;
}

export async function POST(request, { params }) {
  try {
    const result = requireAuth(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { id } = await params;
    const db = getDb();

    const originalBill = db.prepare('SELECT * FROM bills WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!originalBill) {
      return NextResponse.json({ error: 'Original bill nahi mila' }, { status: 404 });
    }
    if (originalBill.type === 'return') {
      return NextResponse.json({ error: 'Return bill ka return nahi ho sakta' }, { status: 400 });
    }

    const body = await request.json();
    const items = body?.items;
    const refundMode = body?.refund_mode;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Kam se kam ek item select karo' }, { status: 400 });
    }
    if (!['cash', 'upi', 'card'].includes(refundMode)) {
      return NextResponse.json({ error: 'Refund mode galat hai' }, { status: 400 });
    }

    const originalItems = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(id);

    const normalizedItems = [];
    for (const [index, item] of items.entries()) {
      const categoryId = Number(item?.category_id);
      const quantity = Number(item?.quantity);
      const amount = Number(item?.amount);

      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return NextResponse.json({ error: `Return item ${index + 1}: category galat hai` }, { status: 400 });
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return NextResponse.json({ error: `Return item ${index + 1}: quantity galat hai` }, { status: 400 });
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: `Return item ${index + 1}: amount galat hai` }, { status: 400 });
      }

      const origItem = originalItems.find(oi => oi.category_id === categoryId);
      if (!origItem) {
        return NextResponse.json({ error: `Return item ${index + 1}: ye item original bill mein nahi hai` }, { status: 400 });
      }
      if (quantity > origItem.quantity) {
        return NextResponse.json({ error: `Return item ${index + 1}: quantity original se zyada hai` }, { status: 400 });
      }

      normalizedItems.push({ category_id: categoryId, quantity, amount: round2(amount) });
    }

    const subtotal = round2(normalizedItems.reduce((s, i) => s + i.amount, 0));
    const total = subtotal;

    if (total <= 0) {
      return NextResponse.json({ error: 'Return amount 0 se zyada hona chahiye' }, { status: 400 });
    }

    const insertBill = db.prepare(`
      INSERT INTO bills (bill_number, subtotal, discount_percent, discount_amount, total, payment_mode, salesman_id, notes, type, original_bill_id)
      VALUES (?, ?, 0, 0, ?, ?, ?, ?, 'return', ?)
    `);
    const insertItem = db.prepare('INSERT INTO bill_items (bill_id, category_id, quantity, amount) VALUES (?, ?, ?, ?)');
    const insertPayment = db.prepare('INSERT INTO bill_payments (bill_id, mode, amount) VALUES (?, ?, ?)');

    const createReturn = db.transaction((billNumber) => {
      const res = insertBill.run(billNumber, subtotal, total, refundMode, result.user.id, `Return against ${originalBill.bill_number}`, id);
      const billId = res.lastInsertRowid;
      for (const item of normalizedItems) {
        insertItem.run(billId, item.category_id, item.quantity, item.amount);
      }
      insertPayment.run(billId, refundMode, total);

      if (refundMode === 'cash') {
        updateCashDrawer(db, -total);
      }

      return { billId, billNumber };
    });

    let bill = null;
    let attempts = 0;
    while (!bill && attempts < 3) {
      attempts++;
      try {
        bill = createReturn(generateBillNumber());
      } catch (err) {
        if (String(err?.message || '').includes('UNIQUE constraint') && attempts < 3) continue;
        throw err;
      }
    }

    if (!bill) {
      return NextResponse.json({ error: 'Return bill number generate nahi hua' }, { status: 500 });
    }

    return NextResponse.json({
      message: 'Return process ho gaya!',
      bill_number: bill.billNumber,
      bill_id: bill.billId,
      refund_amount: total,
    }, { status: 201 });

  } catch (err) {
    console.error('Return bill error:', err);
    return NextResponse.json({ error: 'Return process mein gadbad' }, { status: 500 });
  }
}
