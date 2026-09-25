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
