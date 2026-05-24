import { NextResponse } from 'next/server';
import { getDb, getISTNow } from '@/lib/db';
import { requireAuth, requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const VPA_REGEX = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;
const MAX_LABEL = 40;
const MAX_PAYEE = 99;

export async function GET(request) {
  try {
    const result = requireAuth(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('all') === 'true';

    const db = getDb();
    const whereClause = includeInactive ? '1=1' : 'active = 1';
    const accounts = db.prepare(
      `SELECT id, label, upi_id, payee_name, active, is_default, display_order
       FROM upi_accounts WHERE ${whereClause}
       ORDER BY is_default DESC, display_order, id`
    ).all();

    return NextResponse.json({ accounts });
  } catch (err) {
    console.error('UPI accounts list error:', err);
    return NextResponse.json({ error: 'Kuch gadbad ho gayi' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const result = requireAdmin(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const body = await request.json();
    const label = typeof body?.label === 'string' ? body.label.trim() : '';
    const upiId = typeof body?.upi_id === 'string' ? body.upi_id.trim() : '';
    const payeeName = typeof body?.payee_name === 'string' ? body.payee_name.trim() : '';
    const makeDefault = typeof body?.is_default === 'boolean' ? body.is_default : false;

    if (!label) {
      return NextResponse.json({ error: 'Label zaroori hai' }, { status: 400 });
    }
    if (label.length > MAX_LABEL) {
      return NextResponse.json({ error: `Label bahut bada hai (max ${MAX_LABEL} chars)` }, { status: 400 });
    }
    if (!VPA_REGEX.test(upiId)) {
      return NextResponse.json({ error: 'UPI ID galat format mein hai (jaise: name@okhdfcbank)' }, { status: 400 });
    }
    if (!payeeName) {
      return NextResponse.json({ error: 'Payee name zaroori hai' }, { status: 400 });
    }
    if (payeeName.length > MAX_PAYEE) {
      return NextResponse.json({ error: `Payee name bahut bada hai (max ${MAX_PAYEE} chars)` }, { status: 400 });
    }

    const db = getDb();
    const adminId = result.user.id;
    const now = getISTNow();

    // Reactivate inactive duplicate if it exists
    const inactive = db.prepare('SELECT id FROM upi_accounts WHERE upi_id = ? AND active = 0').get(upiId);
    if (inactive) {
      const reactivate = db.transaction(() => {
        if (makeDefault) {
          db.prepare('UPDATE upi_accounts SET is_default = 0').run();
        }
        db.prepare(`UPDATE upi_accounts
          SET active = 1, label = ?, payee_name = ?, is_default = ?, updated_by = ?, updated_at = ?
          WHERE id = ?`).run(label, payeeName, makeDefault ? 1 : 0, adminId, now, inactive.id);
      });
      reactivate();
      return NextResponse.json({ message: 'UPI account wapas active kar diya', id: inactive.id }, { status: 200 });
    }

    const existing = db.prepare('SELECT id FROM upi_accounts WHERE upi_id = ? AND active = 1').get(upiId);
    if (existing) {
      return NextResponse.json({ error: 'Ye UPI ID already add hai' }, { status: 400 });
    }

    const maxOrder = db.prepare('SELECT MAX(display_order) as max_order FROM upi_accounts').get();
    const nextOrder = (maxOrder?.max_order || 0) + 1;

    const insert = db.transaction(() => {
      if (makeDefault) {
        db.prepare('UPDATE upi_accounts SET is_default = 0').run();
      }
      const info = db.prepare(
        `INSERT INTO upi_accounts (label, upi_id, payee_name, is_default, display_order, created_by, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(label, upiId, payeeName, makeDefault ? 1 : 0, nextOrder, adminId, adminId, now);
      return info.lastInsertRowid;
    });

    const id = insert();

    return NextResponse.json({ message: 'UPI account add ho gaya', id }, { status: 201 });
  } catch (err) {
    console.error('Create UPI account error:', err);
    return NextResponse.json({ error: 'UPI account banane mein gadbad' }, { status: 500 });
  }
}
