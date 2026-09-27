// Validates and normalises the body of a sale -- shared by creating a bill
// (POST /api/bills) and the admin's in-place edit (PUT /api/bills/[id]), so both
// go through exactly the same money checks.
//
// Returns { error, status } on bad input, otherwise the normalised bill.
import { normalizePhone, isValidPhone } from '@/lib/phone';
import { MAX_MRP, MAX_QTY_PER_LINE } from '@/lib/limits';

const VALID_PAYMENT_MODES = new Set(['cash', 'upi', 'card']);

export function round2(value) {
  return Math.round(value * 100) / 100;
}

const fail = (error, status = 400) => ({ error, status });

export function parseBillInput(body, user, db) {
  const items = body?.items;
  const payments = body?.payments;
  const discountPercentInput = Number(body?.discount_percent ?? 0);
  // When the client sends discount_amount (even 0) it is the source of truth;
  // the percent is only a fallback for clients that send nothing else.
  const hasDiscountAmount = typeof body?.discount_amount === 'number';
  const discountAmountInput = Number(body?.discount_amount ?? 0);

  // Optional customer. Invalid numbers are refused: a half-typed number is
  // worse than none in a customer list.
  const customerPhoneRaw = typeof body?.customer_phone === 'string' ? body.customer_phone.trim() : '';
  const customerPhone = customerPhoneRaw ? normalizePhone(customerPhoneRaw) : '';
  const customerName = typeof body?.customer_name === 'string' ? body.customer_name.trim().slice(0, 60) : '';
  if (customerPhoneRaw && !isValidPhone(customerPhone)) {
    return fail('Customer ka mobile number sahi nahi hai (10 digit)');
  }
  const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';

  if (!items || !Array.isArray(items) || items.length === 0) {
    return fail('Kam se kam ek item daalo');
  }
  if (!payments || !Array.isArray(payments) || payments.length === 0) {
    return fail('Kam se kam ek payment mode daalo');
  }
  if (items.length > 100 || payments.length > 3) {
    return fail('Bill mein bahut zyada items ya payments hain');
  }
  if (notes.length > 500) {
    return fail('Note 500 characters se chhota rakho');
  }

  for (const [i, p] of payments.entries()) {
    if (!VALID_PAYMENT_MODES.has(p?.mode)) {
      return fail(`Payment ${i + 1}: mode cash, upi ya card hona chahiye`);
    }
    const amt = Number(p?.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return fail(`Payment ${i + 1}: amount galat hai`);
    }
  }

  if (!Number.isFinite(discountAmountInput) || discountAmountInput < 0) {
    return fail('Discount amount galat hai');
  }
  if (!Number.isFinite(discountPercentInput) || discountPercentInput < 0 || discountPercentInput > 100) {
    return fail('Discount 0-100% ke beech hona chahiye');
  }

  const normalizedItems = [];
  for (const [index, item] of items.entries()) {
    const categoryId = Number(item?.category_id);
    const quantity = Number(item?.quantity);
    const amount = Number(item?.amount);
    const mrp = item?.mrp != null ? Number(item.mrp) : null;

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return fail(`Item ${index + 1}: category galat hai`);
    }
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QTY_PER_LINE) {
      return fail(`Item ${index + 1}: quantity galat hai`);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return fail(`Item ${index + 1}: amount galat hai`);
    }
    if (mrp !== null && (!Number.isFinite(mrp) || mrp <= 0)) {
      return fail(`Item ${index + 1}: MRP galat hai`);
    }
    if ((mrp ?? amount / quantity) > MAX_MRP) {
      return fail(`Item ${index + 1}: MRP ₹${MAX_MRP.toLocaleString('en-IN')} se zyada nahi ho sakta — check karo`);
    }
    if (mrp !== null && amount > mrp * quantity + 0.01) {
      return fail(`Item ${index + 1}: amount MRP se zyada nahi ho sakta`);
    }

    normalizedItems.push({
      category_id: categoryId,
      mrp: mrp ? round2(mrp) : null,
      quantity,
      amount: round2(amount),
    });
  }

  const subtotal = round2(normalizedItems.reduce((sum, item) => sum + item.amount, 0));
  const mrpTotal = round2(normalizedItems.reduce((sum, item) => sum + ((item.mrp || (item.amount / item.quantity)) * item.quantity), 0));
  const rawDiscountAmt = hasDiscountAmount
    ? discountAmountInput
    : round2(subtotal * (discountPercentInput / 100));
  const discountAmount = round2(Math.min(rawDiscountAmt, subtotal));
  const total = round2(subtotal - discountAmount);
  // Stored percent is always derived from the amount, so the two never disagree.
  const discountPercent = subtotal > 0 ? round2((discountAmount / subtotal) * 100) : 0;

  if (total <= 0) {
    return fail('Total amount 0 se zyada hona chahiye');
  }

  const normalizedPayments = payments.map(p => ({ mode: p.mode, amount: round2(Number(p.amount)) }));
  const paymentSum = round2(normalizedPayments.reduce((s, p) => s + p.amount, 0));
  if (Math.abs(paymentSum - total) > 0.01) {
    return fail(`Payment total (₹${paymentSum}) bill total (₹${total}) se match nahi karta`);
  }
  const modes = [...new Set(normalizedPayments.map(p => p.mode))];
  const paymentMode = modes.length === 1 ? modes[0] : 'mixed';
  const cashAmount = round2(normalizedPayments.filter(p => p.mode === 'cash').reduce((s, p) => s + p.amount, 0));

  // Who the sale is credited to: the named salesman (must be active), else the user.
  let salesman = { id: user.id, name: user.name };
  const requestedSalesmanId = body?.salesman_id ? Number(body.salesman_id) : null;
  if (requestedSalesmanId) {
    const target = db.prepare('SELECT id, name, active FROM users WHERE id = ?').get(requestedSalesmanId);
    if (!target || !target.active) {
      return fail('Selected salesman invalid hai');
    }
    salesman = { id: target.id, name: target.name };
  }

  const uniqueCategoryIds = [...new Set(normalizedItems.map(item => item.category_id))];
  const placeholders = uniqueCategoryIds.map(() => '?').join(',');
  const existingCategories = db.prepare(
    `SELECT id, name FROM categories WHERE id IN (${placeholders})`
  ).all(...uniqueCategoryIds);
  if (existingCategories.length !== uniqueCategoryIds.length) {
    return fail('Ek ya zyada category invalid hai');
  }
  const categoryNameMap = Object.fromEntries(existingCategories.map(c => [c.id, c.name]));

  return {
    items: normalizedItems,
    payments: normalizedPayments,
    subtotal,
    mrpTotal,
    discountAmount,
    discountPercent,
    total,
    paymentMode,
    cashAmount,
    salesman,
    requestedSalesmanId,
    customerPhone,
    customerName,
    notes,
    categoryNameMap,
  };
}

// Links a bill to its customer (one row per phone = household) inside the
// caller's transaction. Returns { customerId, customerName } for the bill.
export function upsertCustomer(db, phone, name, seenAt) {
  if (!phone) return { customerId: null, customerName: name || null };
  const existing = db.prepare('SELECT id, name FROM customers WHERE phone = ?').get(phone);
  if (existing) {
    db.prepare(`UPDATE customers SET name = COALESCE(?, name),
                   last_seen_at = MAX(COALESCE(last_seen_at, ''), ?) WHERE id = ?`)
      .run(name || null, seenAt, existing.id);
    return { customerId: existing.id, customerName: name || existing.name || null };
  }
  const id = db.prepare('INSERT INTO customers (phone, name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)')
    .run(phone, name || null, seenAt, seenAt).lastInsertRowid;
  return { customerId: id, customerName: name || null };
}
