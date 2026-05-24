import { NextResponse } from 'next/server';
import { getDb, getISTNow } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const VPA_REGEX = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;
const MAX_LABEL = 40;
const MAX_PAYEE = 99;

const SAFE_ERRORS = new Set([
  'Label zaroori hai',
  'UPI ID galat format mein hai',
  'Ye UPI ID already add hai',
  'Payee name zaroori hai',
  `Label bahut bada hai (max ${MAX_LABEL} chars)`,
  `Payee name bahut bada hai (max ${MAX_PAYEE} chars)`,
  'active boolean hona chahiye',
  'is_default boolean hona chahiye',
]);

export async function PATCH(request, { params }) {
  try {
    const result = requireAdmin(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { id: rawId } = await params;
    const id = parseInt(rawId, 10);
    if (!Number.isInteger(id) || id <= 0 || String(id) !== String(rawId)) {
      return NextResponse.json({ error: 'UPI account nahi mila' }, { status: 404 });
    }

    const body = await request.json();
    const db = getDb();

    const acct = db.prepare('SELECT * FROM upi_accounts WHERE id = ?').get(id);
    if (!acct) {
      return NextResponse.json({ error: 'UPI account nahi mila' }, { status: 404 });
    }

    const adminId = result.user.id;
    const now = getISTNow();
    let changed = false;

    const update = db.transaction(() => {
      if (body.label !== undefined) {
        if (typeof body.label !== 'string') throw new Error('Label zaroori hai');
        const label = body.label.trim();
        if (!label) throw new Error('Label zaroori hai');
        if (label.length > MAX_LABEL) throw new Error(`Label bahut bada hai (max ${MAX_LABEL} chars)`);
        db.prepare('UPDATE upi_accounts SET label = ? WHERE id = ?').run(label, id);
        changed = true;
      }
      if (body.upi_id !== undefined) {
        if (typeof body.upi_id !== 'string') throw new Error('UPI ID galat format mein hai');
        const upiId = body.upi_id.trim();
        if (!VPA_REGEX.test(upiId)) throw new Error('UPI ID galat format mein hai');
        const dup = db.prepare('SELECT id FROM upi_accounts WHERE upi_id = ? AND id != ? AND active = 1').get(upiId, id);
        if (dup) throw new Error('Ye UPI ID already add hai');
        db.prepare('UPDATE upi_accounts SET upi_id = ? WHERE id = ?').run(upiId, id);
        changed = true;
      }
      if (body.payee_name !== undefined) {
        if (typeof body.payee_name !== 'string') throw new Error('Payee name zaroori hai');
        const payeeName = body.payee_name.trim();
        if (!payeeName) throw new Error('Payee name zaroori hai');
        if (payeeName.length > MAX_PAYEE) throw new Error(`Payee name bahut bada hai (max ${MAX_PAYEE} chars)`);
        db.prepare('UPDATE upi_accounts SET payee_name = ? WHERE id = ?').run(payeeName, id);
        changed = true;
      }
      if (body.active !== undefined) {
        if (typeof body.active !== 'boolean') throw new Error('active boolean hona chahiye');
        db.prepare('UPDATE upi_accounts SET active = ? WHERE id = ?').run(body.active ? 1 : 0, id);
        changed = true;
      }
      if (body.is_default !== undefined) {
        if (typeof body.is_default !== 'boolean') throw new Error('is_default boolean hona chahiye');
        if (body.is_default) {
          db.prepare('UPDATE upi_accounts SET is_default = 0').run();
          db.prepare('UPDATE upi_accounts SET is_default = 1 WHERE id = ?').run(id);
        } else {
          db.prepare('UPDATE upi_accounts SET is_default = 0 WHERE id = ?').run(id);
        }
        changed = true;
      }
      if (changed) {
        db.prepare('UPDATE upi_accounts SET updated_by = ?, updated_at = ? WHERE id = ?').run(adminId, now, id);
      }
    });

    try {
      update();
    } catch (e) {
      const msg = SAFE_ERRORS.has(e.message) ? e.message : 'Update fail';
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    return NextResponse.json({ message: 'UPI account update ho gaya' });
  } catch (err) {
    console.error('Update UPI account error:', err);
    return NextResponse.json({ error: 'UPI account update karne mein gadbad' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const result = requireAdmin(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { id: rawId } = await params;
    const id = parseInt(rawId, 10);
    if (!Number.isInteger(id) || id <= 0 || String(id) !== String(rawId)) {
      return NextResponse.json({ error: 'UPI account nahi mila' }, { status: 404 });
    }

    const db = getDb();

    const acct = db.prepare('SELECT * FROM upi_accounts WHERE id = ?').get(id);
    if (!acct) {
      return NextResponse.json({ error: 'UPI account nahi mila' }, { status: 404 });
    }

    const adminId = result.user.id;
    const now = getISTNow();
    db.prepare(
      'UPDATE upi_accounts SET active = 0, is_default = 0, updated_by = ?, updated_at = ? WHERE id = ?'
    ).run(adminId, now, id);

    return NextResponse.json({ message: 'UPI account hata diya' });
  } catch (err) {
    console.error('Delete UPI account error:', err);
    return NextResponse.json({ error: 'UPI account hatane mein gadbad' }, { status: 500 });
  }
}
