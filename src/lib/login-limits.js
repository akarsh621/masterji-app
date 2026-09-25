// Brute-force protection for the public login endpoint. Salesman PINs are only
// 4 digits, so without this anyone could try all 10,000 in a few minutes.
// Attempts are stored in SQLite so a redeploy doesn't reset the counters.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_ACCOUNT_AND_IP = 5;   // one phone guessing one person's PIN
const MAX_PER_IP = 30;              // one address guessing across everyone
const MAX_PER_ACCOUNT = 20;         // one person guessed at from many addresses

export const LOCKED_MESSAGE = 'Bahut baar galat try hua — 15 minute baad dobara try karo';

export function clientIp(request) {
  // Railway's edge strips any client-sent X-Forwarded-For and puts the real
  // client address first, so the leftmost entry is trustworthy there.
  // X-Real-IP is only a fallback (it has been unreliable on Railway's CDN path).
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}

export function isLocked(db, account, ip) {
  const since = Date.now() - WINDOW_MS;
  const count = (sql, ...params) => db.prepare(sql).get(...params).n;
  return (
    count('SELECT COUNT(*) AS n FROM login_attempts WHERE account = ? AND ip = ? AND at > ?', account, ip, since) >= MAX_PER_ACCOUNT_AND_IP ||
    count('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > ?', ip, since) >= MAX_PER_IP ||
    count('SELECT COUNT(*) AS n FROM login_attempts WHERE account = ? AND at > ?', account, since) >= MAX_PER_ACCOUNT
  );
}

export function recordFailure(db, account, ip) {
  db.prepare('INSERT INTO login_attempts (account, ip, at) VALUES (?, ?, ?)').run(account, ip, Date.now());
  // Keep the table small: nothing older than a day matters.
  if (Math.random() < 0.05) {
    db.prepare('DELETE FROM login_attempts WHERE at < ?').run(Date.now() - 24 * 60 * 60 * 1000);
  }
}

export function recordSuccess(db, account, ip) {
  db.prepare('DELETE FROM login_attempts WHERE account = ? AND ip = ?').run(account, ip);
}
