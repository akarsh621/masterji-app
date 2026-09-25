import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/db';
import { signToken } from '@/lib/auth';
import { clientIp, isLocked, recordFailure, recordSuccess, LOCKED_MESSAGE } from '@/lib/login-limits';

export const dynamic = 'force-dynamic';

const PIN_REGEX = /^\d{4}$/;
// Compared against when the username doesn't exist, so response time doesn't
// reveal which admin usernames are real.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

function loginResponse(user) {
  return NextResponse.json({
    token: signToken(user),
    user: { id: user.id, name: user.name, role: user.role },
  });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    const db = getDb();
    const ip = clientIp(request);

    // Runs one login attempt with lockout accounting around it.
    const attempt = (account, check) => {
      if (isLocked(db, account, ip)) {
        return NextResponse.json({ error: LOCKED_MESSAGE }, { status: 429 });
      }
      const outcome = check();
      if (outcome.user) {
        recordSuccess(db, account, ip);
        return loginResponse(outcome.user);
      }
      recordFailure(db, account, ip);
      return NextResponse.json({ error: outcome.error }, { status: outcome.status || 401 });
    };

    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (username && password) {
      return attempt(`admin:${username.toLowerCase()}`, () => {
        const user = db.prepare(
          'SELECT * FROM users WHERE username = ? AND role = ? AND active = 1'
        ).get(username, 'admin');
        const ok = bcrypt.compareSync(password, user?.password_hash || DUMMY_HASH);
        return user && ok ? { user } : { error: 'Galat username ya password' };
      });
    }

    const pin = String(body?.pin ?? '');
    if (pin && !PIN_REGEX.test(pin)) {
      return NextResponse.json({ error: 'PIN 4 digit ka hona chahiye' }, { status: 400 });
    }

    if (body?.salesman_id !== undefined && pin) {
      const salesmanId = Number(body.salesman_id);
      if (!Number.isInteger(salesmanId) || salesmanId <= 0) {
        return NextResponse.json({ error: 'Salesman select karo' }, { status: 400 });
      }
      return attempt(`salesman:${salesmanId}`, () => {
        const user = db.prepare(
          'SELECT * FROM users WHERE id = ? AND pin = ? AND role = ? AND active = 1'
        ).get(salesmanId, pin, 'salesman');
        return user ? { user } : { error: 'Galat salesman ya PIN' };
      });
    }

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (name && pin) {
      return attempt(`name:${name.toLowerCase()}`, () => {
        const users = db.prepare(
          'SELECT * FROM users WHERE name = ? AND pin = ? AND role = ? AND active = 1'
        ).all(name, pin, 'salesman');
        if (users.length === 1) return { user: users[0] };
        if (users.length > 1) return { error: 'Is naam ke multiple log mile, admin se check karwao', status: 400 };
        return { error: 'Galat naam ya PIN' };
      });
    }

    return NextResponse.json({ error: 'Username/password ya name/PIN daalo' }, { status: 400 });
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Kuch gadbad ho gayi' }, { status: 500 });
  }
}
