export function normalizeBillItems(items) {
  return items.map(item => ({
    name: item.category_name || item.name || 'Item',
    qty: item.quantity || item.qty || 1,
    mrp: item.mrp || Math.round((item.amount || 0) / (item.quantity || item.qty || 1)),
    amount: Math.round(item.amount || 0),
  }));
}

export function normalizeSavedBill(bill) {
  const items = normalizeBillItems(bill.items || []);
  const mrpTotal = bill.mrp_total || items.reduce((s, i) => s + (i.mrp * i.qty), 0);
  const sellingTotal = bill.subtotal || items.reduce((s, i) => s + i.amount, 0);
  const total = Math.round(bill.total || 0);
  const itemDiscount = Math.round(mrpTotal - sellingTotal);
  const itemDiscountPercent = mrpTotal > 0 ? Math.round((itemDiscount / mrpTotal) * 100) : 0;
  const billDiscount = Math.round(bill.discount_amount || 0);
  const totalDiscount = Math.round(mrpTotal - total);
  const totalDiscountPercent = mrpTotal > 0 ? Math.round((totalDiscount / mrpTotal) * 100) : 0;

  return {
    billNumber: bill.bill_number || '',
    salesmanName: bill.salesman_name || '',
    createdAt: bill.created_at || '',
    items,
    mrpTotal: Math.round(mrpTotal),
    sellingTotal: Math.round(sellingTotal),
    itemDiscount,
    itemDiscountPercent,
    billDiscount,
    totalDiscount,
    totalDiscountPercent,
    total,
    payments: bill.payments || [],
    notes: bill.notes || '',
  };
}
