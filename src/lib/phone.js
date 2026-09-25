// Customer mobile numbers are stored as plain 10-digit Indian numbers, so
// "+91 98765-43210", "098765 43210" and "9876543210" are all the same customer.
export function normalizePhone(input) {
  let digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

export function isValidPhone(phone) {
  return /^[6-9]\d{9}$/.test(phone);
}
