import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { normalizePhone, isValidPhone } from '@/lib/phone';

export const dynamic = 'force-dynamic';

// Used on the payment screen once a full mobile number is typed: a known
// customer's name fills in, with how many times they've bought before.
export async function GET(request) {
  const result = requireAuth(request);
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });

  const phone = normalizePhone(new URL(request.url).searchParams.get('phone'));
  if (!isValidPhone(phone)) {
    return NextResponse.json({ error: 'Mobile number sahi nahi hai' }, { status: 400 });
  }

  const db = getDb();
  const customer = db.prepare(`
    SELECT c.id, c.phone, c.name,
           (SELECT COUNT(*) FROM bills b WHERE b.customer_id = c.id AND b.type = 'sale' AND b.deleted_at IS NULL) AS visits
    FROM customers c WHERE c.phone = ?
  `).get(phone);
  return NextResponse.json({ customer: customer || null, phone });
}
