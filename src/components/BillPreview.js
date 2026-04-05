'use client';

const PAYMENT_ICONS = { cash: '💵', upi: '📱', card: '💳' };

export default function BillPreview({
  items,
  mrpTotal,
  sellingTotal,
  total,
  totalDiscount,
  totalDiscountPercent,
  payments,
  notes,
  compact,
}) {
  const fmt = n => Math.round(n).toLocaleString('en-IN');

  return (
    <div>
      {/* Item rows */}
      {items.map((item, idx) => {
        const discPerc = item.mrp > 0 && item.amount < item.mrp * item.qty
          ? Math.round(((item.mrp * item.qty - item.amount) / (item.mrp * item.qty)) * 100)
          : 0;
        return (
          <div key={idx} className={`flex justify-between ${compact ? 'py-0.5 text-xs' : 'py-1.5 text-base'}`}>
            <span className="text-gray-700">
              {idx + 1}. {item.name}
              {discPerc > 0 ? ` — ₹${item.mrp} -${discPerc}%` : ` — ₹${item.mrp}`}
              {item.qty > 1 ? ` ×${item.qty}` : ''}
            </span>
            <span className="font-medium">₹{fmt(item.amount)}</span>
          </div>
        );
      })}

      {/* Summary */}
      <div className="border-t border-gray-200 mt-2 pt-2 space-y-0.5">
        <div className={`flex justify-between ${compact ? 'text-xs' : 'text-base'} text-gray-500`}>
          <span>MRP Total</span>
          <span>₹{fmt(mrpTotal)}</span>
        </div>
        {sellingTotal !== undefined && sellingTotal !== total && (
          <div className={`flex justify-between ${compact ? 'text-xs' : 'text-base'} font-bold`}>
            <span>Selling Total</span>
            <span>₹{fmt(sellingTotal)}</span>
          </div>
        )}
        {totalDiscount > 0 && (
          <div className={`flex justify-between ${compact ? 'text-xs' : 'text-base'} text-orange-600 font-semibold`}>
            <span>Discount ({totalDiscountPercent}% off MRP)</span>
            <span>-₹{fmt(totalDiscount)}</span>
          </div>
        )}
      </div>

      {/* Payment breakdown */}
      {payments && payments.length > 1 && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <div className="text-xs text-gray-500 mb-1">Payment Split:</div>
          {payments.map((p, i) => (
            <div key={i} className="flex justify-between text-sm py-0.5">
              <span>{PAYMENT_ICONS[p.mode] || ''} {p.mode.toUpperCase()}</span>
              <span>₹{fmt(p.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Notes */}
      {notes && (
        <div className="text-xs text-gray-500 mt-2">Note: {notes}</div>
      )}
    </div>
  );
}
