export function isValidDate(str) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(str)) return false;
  const d = new Date(str + 'T00:00:00');
  const [y, m, day] = str.split('-').map(Number);
  return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day;
}

// Today's date in India as YYYY-MM-DD, regardless of the server's timezone.
export function todayIST() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Whole days from `earlier` to `later`, both YYYY-MM-DD.
export function daysBetweenYMD(earlier, later) {
  const a = new Date(earlier + 'T00:00:00Z').getTime();
  const b = new Date(later + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Current month in India as YYYY-MM.
export function currentISTMonth() {
  return todayIST().slice(0, 7);
}

export function prevMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
}

export function nextMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
}

// "September 2026"
export function monthLabel(m) {
  const [y, mo] = m.split('-').map(Number);
  return `${MONTH_NAMES[mo - 1]} ${y}`;
}

// First and last date (YYYY-MM-DD) of a YYYY-MM month.
export function monthRange(m) {
  const [y, mo] = m.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(lastDay).padStart(2, '0')}` };
}

// ---- GST quarter lock -------------------------------------------------------
// Quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar (financial year). A quarter is
// locked from the 11th of the month after it ends -- the owner has until the
// 10th to fix mistakes before filing CMP-08 (due the 18th). After that, bills
// dated in it can't be cancelled or edited, and nothing can be backdated into
// it, so figures already filed never change. Returns still work: a return is
// dated the day it happens, so it counts in the current quarter.
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = n => String(n).padStart(2, '0');

function quarterBounds(ymd) {
  const [y, m] = ymd.split('-').map(Number);
  const startMonth = Math.floor((m - 1) / 3) * 3 + 1;
  return { year: y, startMonth, endMonth: startMonth + 2 };
}

// First date on which the quarter containing `ymd` is locked (YYYY-MM-11).
export function quarterLockDate(ymd) {
  const { year, endMonth } = quarterBounds(ymd);
  const lockMonth = endMonth === 12 ? 1 : endMonth + 1;
  const lockYear = endMonth === 12 ? year + 1 : year;
  return `${lockYear}-${pad2(lockMonth)}-11`;
}

export function isQuarterLocked(ymd, today = todayIST()) {
  return today >= quarterLockDate(ymd);
}

// "Apr–Jun 2026"
export function quarterLabel(ymd) {
  const { year, startMonth, endMonth } = quarterBounds(ymd);
  return `${SHORT_MONTHS[startMonth - 1]}–${SHORT_MONTHS[endMonth - 1]} ${year}`;
}

export function quarterLockedMessage(ymd) {
  return `Ye bill ${quarterLabel(ymd)} quarter ka hai — GST filing ke liye band ho chuka hai. Badalna ho toh Return karo.`;
}

// ---- Quarters for reports ----------------------------------------------------
function addDaysYmd(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The GST quarter containing `ymd`, e.g. 2026-09-27 ->
// { from: '2026-07-01', to: '2026-09-30', q: 2, fyLabel: 'FY 2026-27', label: 'Jul–Sep 2026' }.
// Quarters follow the financial year: Apr–Jun is Q1, Jan–Mar is Q4 of the previous FY.
export function quarterOf(ymd) {
  const { year, startMonth, endMonth } = quarterBounds(ymd);
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const fyStart = startMonth >= 4 ? year : year - 1;
  return {
    from: `${year}-${pad2(startMonth)}-01`,
    to: `${year}-${pad2(endMonth)}-${pad2(lastDay)}`,
    q: startMonth >= 4 ? (startMonth - 4) / 3 + 1 : 4,
    fyLabel: `FY ${fyStart}-${String(fyStart + 1).slice(2)}`,
    label: quarterLabel(ymd),
  };
}

// CMP-08 due date for the quarter containing `ymd` (18th of the month after it ends).
export function cmp08DueDate(ymd) {
  return quarterLockDate(ymd).slice(0, 8) + '18';
}

// Every quarter from the one containing `firstYmd` up to the current one, newest
// first. The running quarter is marked `current` and ends today.
export function listQuarters(firstYmd, today = todayIST()) {
  const stop = quarterOf(firstYmd && firstYmd < today ? firstYmd : today).from;
  const out = [];
  let q = quarterOf(today);
  for (;;) {
    const current = q.from <= today && today <= q.to;
    out.push({ ...q, current, to: current ? today : q.to });
    if (q.from <= stop) break;
    q = quarterOf(addDaysYmd(q.from, -1));
  }
  return out;
}

// The quarter a from/to range covers exactly (a whole quarter, or the running
// quarter up to today), or null.
export function matchQuarter(from, to, today = todayIST()) {
  if (!from || !to) return null;
  const q = quarterOf(from);
  if (from !== q.from) return null;
  if (to === q.to) return { ...q, current: false };
  if (to === today && q.from <= today && today <= q.to) return { ...q, current: true, to: today };
  return null;
}

export function previousQuarter(ymd) {
  return quarterOf(addDaysYmd(quarterOf(ymd).from, -1));
}
