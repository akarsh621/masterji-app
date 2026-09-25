import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const PIN_REGEX = /^\d{4}$/;

export async function PATCH(request, { params }) {
  try {
    const result = requireAdmin(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { id } = await params;
    const userId = Number(id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: 'User ID galat hai' }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request data galat hai' }, { status: 400 });
    }
    const db = getDb();

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return NextResponse.json({ error: 'User nahi mila' }, { status: 404 });
    }

    const nextName = body.name !== undefined
      ? (typeof body.name === 'string' ? body.name.trim() : '')
      : user.name;
    if (body.name !== undefined && !nextName) {
      return NextResponse.json({ error: 'Naam khali nahi ho sakta' }, { status: 400 });
    }

    if (body.active !== undefined && typeof body.active !== 'boolean') {
      return NextResponse.json({ error: 'Active field true/false hona chahiye' }, { status: 400 });
    }

    const nextActive = body.active !== undefined ? body.active : Boolean(user.active);
    if (user.role === 'salesman' && nextActive) {
      const duplicate = db.prepare(
        "SELECT id FROM users WHERE role = 'salesman' AND active = 1 AND lower(name) = lower(?) AND id != ?"
      ).get(nextName, userId);
      if (duplicate) {
        return NextResponse.json({ error: 'Is naam ka salesman already active hai' }, { status: 400 });
      }
    }

    // Validate everything first, then apply all changes in one transaction, so a
    // bad PIN or password never leaves a half-updated user.
    let nextPin = null;
    if (body.pin !== undefined && user.role === 'salesman') {
      nextPin = String(body.pin);
      if (!PIN_REGEX.test(nextPin)) {
        return NextResponse.json({ error: 'PIN 4 digit ka hona chahiye' }, { status: 400 });
      }
    }
    let nextUsername = null;
    if (body.username !== undefined && user.role === 'admin') {
      nextUsername = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
      if (!nextUsername || nextUsername.length < 3) {
        return NextResponse.json({ error: 'Username kam se kam 3 characters ka hona chahiye' }, { status: 400 });
      }
      const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(nextUsername, userId);
      if (existing) {
        return NextResponse.json({ error: 'Ye username pehle se kisi aur ka hai' }, { status: 400 });
      }
    }
    let nextPasswordHash = null;
    if (body.password !== undefined && user.role === 'admin') {
      const nextPassword = typeof body.password === 'string' ? body.password : '';
      if (nextPassword.length < 4) {
        return NextResponse.json({ error: 'Password kam se kam 4 characters ka hona chahiye' }, { status: 400 });
      }
      nextPasswordHash = bcrypt.hashSync(nextPassword, 10);
    }

    db.transaction(() => {
      if (body.name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(nextName, userId);
      if (nextPin !== null) db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(nextPin, userId);
      if (nextUsername !== null) db.prepare('UPDATE users SET username = ? WHERE id = ?').run(nextUsername, userId);
      if (nextPasswordHash !== null) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(nextPasswordHash, userId);
      if (body.active !== undefined) db.prepare('UPDATE users SET active = ? WHERE id = ?').run(body.active ? 1 : 0, userId);
    })();

    return NextResponse.json({ message: 'User update ho gaya' });
  } catch (err) {
    console.error('Update user error:', err);
    return NextResponse.json({ error: 'User update karne mein gadbad' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const result = requireAdmin(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { id } = await params;
    const userId = Number(id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: 'User ID galat hai' }, { status: 400 });
    }
    const db = getDb();

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return NextResponse.json({ error: 'User nahi mila' }, { status: 404 });
    }

    if (user.role === 'admin') {
      const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND active = 1").get();
      if (adminCount.count <= 1) {
        return NextResponse.json({ error: 'Last admin ko delete nahi kar sakte' }, { status: 400 });
      }
    }

    // Anyone with history (bills, cash-outs, expenses, print jobs) is deactivated,
    // never deleted, so old records keep pointing at a real person.
    const hasHistory = db.prepare(`
      SELECT
        EXISTS(SELECT 1 FROM bills WHERE salesman_id = ?) OR
        EXISTS(SELECT 1 FROM cash_out WHERE recorded_by = ?) OR
        EXISTS(SELECT 1 FROM expenses WHERE recorded_by = ?) OR
        EXISTS(SELECT 1 FROM print_queue WHERE requested_by = ?) AS has
    `).get(userId, userId, userId, userId).has;
    if (hasHistory) {
      db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(userId);
      return NextResponse.json({ message: 'Is user ka purana record hai isliye deactivate kiya (delete nahi)' });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return NextResponse.json({ message: 'User delete ho gaya' });

  } catch (err) {
    console.error('Delete user error:', err);
    return NextResponse.json({ error: 'User delete karne mein gadbad' }, { status: 500 });
  }
}
