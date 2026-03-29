import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

const PIN_REGEX = /^\d{4}$/;

export async function GET(request) {
  try {
    const result = requireAdmin(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const db = getDb();
    const users = db.prepare(
      "SELECT id, name, role, username, pin, active, created_at FROM users ORDER BY role, name"
    ).all();

    return NextResponse.json({ users });
  } catch (err) {
    console.error('Users list error:', err);
    return NextResponse.json({ error: 'Users load karne mein gadbad' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const result = requireAdmin(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const body = await request.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const role = body?.role;

    if (!name || !role) {
      return NextResponse.json({ error: 'Naam aur role zaroori hai' }, { status: 400 });
    }

    const db = getDb();

    if (role === 'admin') {
      const username = typeof body?.username === 'string' ? body.username.trim() : '';
      const password = typeof body?.password === 'string' ? body.password : '';
      if (!username || !password) {
        return NextResponse.json({ error: 'Admin ke liye username aur password zaroori' }, { status: 400 });
      }

      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        return NextResponse.json({ error: 'Ye username pehle se use ho raha hai' }, { status: 400 });
      }

      const hash = bcrypt.hashSync(password, 10);
      const stmt = db.prepare(
        'INSERT INTO users (name, role, username, password_hash) VALUES (?, ?, ?, ?)'
      );
      const info = stmt.run(name, 'admin', username, hash);
      return NextResponse.json({ message: 'Admin ban gaya', id: info.lastInsertRowid }, { status: 201 });
    }

    if (role === 'salesman') {
      const pin = String(body?.pin ?? '');
      if (!PIN_REGEX.test(pin)) {
        return NextResponse.json({ error: 'Salesman ke liye 4-digit PIN zaroori' }, { status: 400 });
      }

      const existing = db.prepare(
        "SELECT id FROM users WHERE role = 'salesman' AND active = 1 AND lower(name) = lower(?)"
      ).get(name);
      if (existing) {
        return NextResponse.json({ error: 'Is naam ka salesman already active hai' }, { status: 400 });
      }

      const stmt = db.prepare(
        'INSERT INTO users (name, role, pin) VALUES (?, ?, ?)'
      );
      const info = stmt.run(name, 'salesman', pin);
      return NextResponse.json({ message: 'Salesman add ho gaya', id: info.lastInsertRowid }, { status: 201 });
    }

    return NextResponse.json({ error: 'Role admin ya salesman hona chahiye' }, { status: 400 });
  } catch (err) {
    console.error('Create user error:', err);
    if (String(err?.message || '').includes('UNIQUE constraint failed: users.username')) {
      return NextResponse.json({ error: 'Ye username pehle se use ho raha hai' }, { status: 400 });
    }
    return NextResponse.json({ error: 'User banane mein gadbad' }, { status: 500 });
  }
}
