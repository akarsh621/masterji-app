export function getISTDateInputValue() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

export const REASON_LABELS = {
  expense: 'Roz ka Kharcha',
  supplier: 'Supplier',
  owner: 'Cash / Sale Withdrawal',
  other: 'Other',
  sweep: 'Daily Sweep',
  manual: 'Cash Out',
};

export const GROUP_LABELS = {
  women: 'Ladies',
  kids: 'Kids',
  men: 'Gents',
  other: 'Other',
};

export const GROUP_COLORS = {
  women: { bg: 'bg-pink-500', text: 'text-pink-700', light: 'bg-pink-50' },
  kids: { bg: 'bg-amber-500', text: 'text-amber-700', light: 'bg-amber-50' },
  men: { bg: 'bg-blue-500', text: 'text-blue-700', light: 'bg-blue-50' },
  other: { bg: 'bg-gray-500', text: 'text-gray-700', light: 'bg-gray-50' },
};
