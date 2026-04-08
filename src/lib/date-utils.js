export function isValidDate(str) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(str)) return false;
  const d = new Date(str + 'T00:00:00');
  const [y, m, day] = str.split('-').map(Number);
  return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day;
}
