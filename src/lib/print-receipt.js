import { normalizeSavedBill } from '@/lib/bill-data';

const SHOP_ADDRESS = 'C Block, Main Market Road\nShastri Nagar, Ghaziabad';
const SHOP_PHONE = 'Ph: 9540664066 / 0120-4245977';
// Composition-scheme Bill of Supply: GSTIN plus the declaration required on
// every bill. Keep in sync with print-agent/agent.py (SHOP_GSTIN).
const SHOP_GSTIN = '09AGHPG4211E1ZV';
const COMPOSITION_NOTE = 'Composition taxable person, not eligible to collect tax on supplies';
// QR for the Google review link (https://g.page/r/Cdj1aJR-po6TEBI/review), generated
// once into /public so receipts never depend on a third-party QR service.
// Absolute URL because the receipt is written into a blank popup window.
const qrImgUrl = () => `${window.location.origin}/review-qr.png`;

function formatDate(dateStr) {
  if (!dateStr) {
    const now = new Date();
    return now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
      + '  ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  }
  const parsed = new Date(dateStr.replace(' ', 'T') + (dateStr.includes('+') ? '' : '+05:30'));
  if (Number.isNaN(parsed.getTime())) return dateStr;
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
    + '  ' + parsed.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

// Everything that comes from the database is escaped before it goes into the
// receipt HTML, so text typed into a bill (e.g. a note) can never run as code.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rupees(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

// Same layout as print-agent/agent.py. Sale lines show the MRP amount
// (MRP x qty) so the column adds up to MRP Total; Discount is everything off
// MRP (item discounts, final price and cash round-off). Return bills show the
// refund per line and a REFUND total instead.
export function buildReceiptHTML(bill) {
  const n = normalizeSavedBill(bill);
  const dateStr = formatDate(n.createdAt);
  const isReturn = bill.type === 'return';
  const rawItems = bill.items || [];

  const lines = n.items.map((item, i) => {
    const mrp = Number(rawItems[i]?.mrp) || 0;
    const lineRs = isReturn || !mrp ? item.amount : mrp * item.qty;
    return { name: item.name, qty: item.qty, rs: Math.round(lineRs) };
  });
  const total = n.total;
  const mrpTotal = lines.reduce((s, l) => s + l.rs, 0);
  const discount = isReturn ? 0 : Math.max(mrpTotal - total, 0);

  const row = (left, right) =>
    `<div style="display:flex;justify-content:space-between"><span>${left}</span><span>${right}</span></div>`;

  const itemsHTML = lines.map(l => `
      <tr>
        <td style="text-align:left">${escapeHtml(l.name)}</td>
        <td style="text-align:center">${escapeHtml(l.qty)}</td>
        <td style="text-align:right">${rupees(l.rs)}</td>
      </tr>`).join('');

  const infoHTML = [
    isReturn ? `<div style="font-size:13px">RETURN${bill.original_bill_number ? ` &mdash; against ${escapeHtml(bill.original_bill_number)}` : ''}</div>` : '',
    n.salesmanName ? `<div style="font-size:13px">Salesman: ${escapeHtml(n.salesmanName)}</div>` : '',
    bill.customer_name ? `<div style="font-size:13px">Customer: ${escapeHtml(bill.customer_name)}</div>` : '',
  ].join('');

  const summaryHTML = isReturn ? '' : `
  <div class="divider"></div>
  ${row('MRP Total', rupees(mrpTotal))}
  ${discount > 0 ? row('Discount', '-' + rupees(discount)) : ''}`;

  const paymentHTML = n.payments.length > 0
    ? n.payments.map(p => row(escapeHtml(String(p.mode).toUpperCase()), rupees(p.amount))).join('')
    : row(escapeHtml((bill.payment_mode || 'cash').toUpperCase()), rupees(total));

  const notesHTML = n.notes
    ? `<div style="margin-top:4px;font-size:13px;color:#000">Note: ${escapeHtml(n.notes)}</div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Receipt ${escapeHtml(n.billNumber)}</title>
<style>
  @page { size: 80mm auto; margin: 2mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 15px;
    font-weight: bold;
    line-height: 1.4;
    width: 76mm;
    max-width: 76mm;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .receipt { padding: 2mm; }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 900; }
  .divider { border-top: 1px dashed #000; margin: 8px 0; }
  .double-divider { border-top: 3px solid #000; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { padding: 4px 0; font-size: 13px; font-weight: 900; border-bottom: 2px solid #000; }
  td { padding: 4px 0; font-size: 14px; font-weight: bold; }
  .total-row { font-size: 20px; font-weight: 900; }
  @media screen {
    body { margin: 10px auto; border: 1px dashed #ccc; padding: 4px; background: #fff; }
  }
</style>
</head>
<body>
<div class="receipt">
  <!-- Bill of Supply: required at the top for a composition dealer -->
  <div class="double-divider"></div>
  <div class="center bold" style="font-size:14px;letter-spacing:1px">BILL OF SUPPLY</div>
  <div class="center" style="font-size:11px">${COMPOSITION_NOTE}</div>
  <div class="double-divider"></div>

  <!-- Shop -->
  <div class="center bold" style="font-size:22px;letter-spacing:1px">MASTER JI<br>FASHION HOUSE</div>
  <div class="center" style="font-size:12px;margin-top:3px;white-space:pre-line">${SHOP_ADDRESS}</div>
  <div class="center" style="font-size:12px">${SHOP_PHONE}</div>
  ${SHOP_GSTIN ? `<div class="center" style="font-size:12px">GSTIN: ${SHOP_GSTIN}</div>` : ''}
  <div class="double-divider"></div>

  <!-- Bill info -->
  <div style="display:flex;justify-content:space-between">
    <span class="bold">Bill: ${escapeHtml(n.billNumber)}</span>
    <span style="font-size:13px">${escapeHtml(dateStr)}</span>
  </div>
  ${infoHTML}
  <div class="divider"></div>

  <!-- Items -->
  <table>
    <thead>
      <tr>
        <th style="text-align:left">Item</th>
        <th style="text-align:center">Qty</th>
        <th style="text-align:right">Rs</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHTML}
    </tbody>
  </table>
  ${summaryHTML}

  <!-- Total -->
  <div class="double-divider"></div>
  <div style="display:flex;justify-content:space-between" class="total-row">
    <span>${isReturn ? 'REFUND' : 'TOTAL'}</span>
    <span>${rupees(total)}</span>
  </div>
  <div class="double-divider"></div>

  <!-- Payment -->
  ${paymentHTML}
  ${notesHTML}
  <div class="divider"></div>
  <div class="center" style="font-size:13px">Exchange / Return sirf 7 din mein</div>
  <div class="divider"></div>

  <!-- Signatory (space above to sign) -->
  <div class="right" style="font-size:13px;margin-top:28px">For MASTER JI FASHION HOUSE<br>Authorised Signatory</div>
  <div class="divider"></div>

  <!-- Footer -->
  <div class="center" style="font-size:14px">Thank you for shopping with us!<br>We look forward to seeing you again.</div>
  <div class="center" style="margin-top:10px">
    <img src="${qrImgUrl()}" width="110" height="110" style="image-rendering:pixelated" />
  </div>
  <div class="center" style="font-size:12px;margin-top:3px">
    Accha laga to upar QR scan karein &#8593;<br>Ek review zarur dein
  </div>
  <div class="double-divider"></div>
</div>
</body>
</html>`;
}

export function printReceipt(bill, { onComplete } = {}) {
  if (!bill) return;

  const html = buildReceiptHTML(bill);
  const popup = window.open('', '_blank', 'width=350,height=700,scrollbars=yes');
  if (!popup) {
    alert('Pop-up block ho gaya. Browser mein pop-ups allow karo.');
    return;
  }

  popup.document.open();
  popup.document.write(html);
  popup.document.close();

  popup.onload = () => {
    setTimeout(() => {
      popup.focus();
      popup.print();
    }, 400);
  };

  popup.onafterprint = () => {
    popup.close();
    if (onComplete) onComplete();
  };
}
