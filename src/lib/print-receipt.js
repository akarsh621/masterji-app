import { normalizeSavedBill } from '@/lib/bill-data';

const SHOP_NAME = 'MASTER JI FASHION HOUSE';
const SHOP_ADDRESS = 'C Block, Main Market Road\nShastri Nagar, Ghaziabad';
const SHOP_PHONE = 'Ph: 9540664066 / 0120-4245977';
const GOOGLE_REVIEW_URL = 'https://g.page/r/Cdj1aJR-po6TEBI/review';
const QR_IMG_URL = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(GOOGLE_REVIEW_URL)}`;

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

function rupees(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function buildReceiptHTML(bill) {
  const n = normalizeSavedBill(bill);
  const dateStr = formatDate(n.createdAt);

  let itemsHTML = '';
  for (const item of n.items) {
    itemsHTML += `
      <tr>
        <td style="text-align:left">${item.name}</td>
        <td style="text-align:center">${item.qty}</td>
        <td style="text-align:right">${rupees(item.amount)}</td>
      </tr>`;
  }

  let paymentHTML = '';
  if (n.payments.length > 1) {
    paymentHTML = '<div style="margin-top:6px">';
    for (const p of n.payments) {
      paymentHTML += `<div style="display:flex;justify-content:space-between"><span>${p.mode.toUpperCase()}</span><span>${rupees(p.amount)}</span></div>`;
    }
    paymentHTML += '</div>';
  } else {
    const mode = (bill.payment_mode || n.payments[0]?.mode || 'cash').toUpperCase();
    paymentHTML = `<div style="margin-top:6px;text-align:center">Payment: ${mode}</div>`;
  }

  const notesHTML = n.notes
    ? `<div style="margin-top:4px;font-size:13px;color:#000">Note: ${n.notes}</div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Receipt ${n.billNumber}</title>
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
  .bold { font-weight: 900; }
  .divider { border-top: 1px dashed #000; margin: 8px 0; }
  .double-divider { border-top: 3px solid #000; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { padding: 4px 0; font-size: 13px; font-weight: 900; border-bottom: 2px solid #000; }
  td { padding: 4px 0; font-size: 14px; font-weight: bold; }
  .total-row { font-size: 20px; font-weight: 900; }
  .discount-row { color: #000; }
  @media screen {
    body { margin: 10px auto; border: 1px dashed #ccc; padding: 4px; background: #fff; }
  }
</style>
</head>
<body>
<div class="receipt">
  <!-- Header -->
  <div class="double-divider"></div>
  <div class="center bold" style="font-size:22px;letter-spacing:1px">MASTER JI<br>FASHION HOUSE</div>
  <div class="center" style="font-size:12px;margin-top:3px;white-space:pre-line">${SHOP_ADDRESS}</div>
  <div class="center" style="font-size:12px">${SHOP_PHONE}</div>
  <div class="double-divider"></div>

  <!-- Bill info -->
  <div style="display:flex;justify-content:space-between">
    <span class="bold">${n.billNumber}</span>
    <span style="font-size:13px">${dateStr}</span>
  </div>
  ${n.salesmanName ? `<div style="font-size:13px">Salesman: ${n.salesmanName}</div>` : ''}
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
  <div class="divider"></div>

  <!-- Discount Given -->
  ${n.totalDiscount > 0 ? `
  <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:900">
    <span>Discount Given</span>
    <span>- ${rupees(n.totalDiscount)}</span>
  </div>` : ''}

  <!-- Total -->
  <div class="double-divider"></div>
  <div style="display:flex;justify-content:space-between" class="total-row">
    <span>TOTAL</span>
    <span>${rupees(n.total)}</span>
  </div>
  <div class="divider"></div>

  <!-- Payment -->
  ${paymentHTML}
  ${notesHTML}
  <div class="divider"></div>

  <!-- Footer -->
  <div class="center" style="font-size:13px;margin-top:6px">
    Exchange / Return sirf 7 din mein
  </div>
  <div class="divider"></div>
  <div class="center bold" style="margin-top:4px;font-size:17px">
    Thank You For Shopping!
  </div>
  <div class="center bold" style="font-size:13px;margin-top:3px">
    Naye kapdo me jach rahe ho,<br>phir zarur aana :)
  </div>

  <!-- QR Code -->
  <div class="center" style="margin-top:10px">
    <img src="${QR_IMG_URL}" width="110" height="110" style="image-rendering:pixelated" />
  </div>
  <div class="center" style="font-size:12px;margin-top:3px">
    Accha laga to Google pe ek review de dena
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
