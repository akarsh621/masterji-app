import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/db';
import { signToken } from '@/lib/auth';

const PIN_REGEX = /^\d{4}$/;

export async function POST(request) {
  try {
    const body = await request.json();
    const db = getDb();

    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (username && password) {
      const user = db.prepare(
        'SELECT * FROM users WHERE username = ? AND role = ? AND active = 1'
      ).get(username, 'admin');

      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return NextResponse.json({ error: 'Galat username ya password' }, { status: 401 });
      }

      const token = signToken(user);
      return NextResponse.json({
        token,
        user: { id: user.id, name: user.name, role: user.role }
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

      const user = db.prepare(
        'SELECT * FROM users WHERE id = ? AND pin = ? AND role = ? AND active = 1'
      ).get(salesmanId, pin, 'salesman');

      if (!user) {
        return NextResponse.json({ error: 'Galat salesman ya PIN' }, { status: 401 });
      }

      const token = signToken(user);
      return NextResponse.json({
        token,
        user: { id: user.id, name: user.name, role: user.role }
      });
    }

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (name && pin) {
      const users = db.prepare(
        'SELECT * FROM users WHERE name = ? AND pin = ? AND role = ? AND active = 1'
      ).all(name, pin, 'salesman');

      if (users.length === 0) {
        return NextResponse.json({ error: 'Galat naam ya PIN' }, { status: 401 });
      }
      if (users.length > 1) {
        return NextResponse.json({ error: 'Is naam ke multiple log mile, admin se check karwao' }, { status: 400 });
      }

      const token = signToken(users[0]);
      return NextResponse.json({
        token,
        user: { id: users[0].id, name: users[0].name, role: users[0].role }
      });
    }

    return NextResponse.json({ error: 'Username/password ya name/PIN daalo' }, { status: 400 });
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Kuch gadbad ho gayi' }, { status: 500 });
  }
}
