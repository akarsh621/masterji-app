import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getDb } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const MAX_AMOUNT = 100000;

export async function GET(request) {
  try {
    const result = requireAuth(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { searchParams } = new URL(request.url);
    const accountId = parseInt(searchParams.get('account_id'), 10);
    const amount = parseFloat(searchParams.get('amount'));

    if (!Number.isInteger(accountId) || accountId <= 0) {
      return NextResponse.json({ error: 'Invalid account_id' }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }
    // Reject non-integer account_id (e.g. 2.5 stringifies to "2.5", parseInt -> 2, but we want strict)
    if (String(accountId) !== searchParams.get('account_id')) {
      return NextResponse.json({ error: 'Invalid account_id' }, { status: 400 });
    }

    const db = getDb();
    const acct = db.prepare(
      'SELECT upi_id, payee_name FROM upi_accounts WHERE id = ? AND active = 1'
    ).get(accountId);
    if (!acct) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const uri = `upi://pay?pa=${encodeURIComponent(acct.upi_id)}&pn=${encodeURIComponent(acct.payee_name)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Master Ji Bill')}`;

    const buffer = await QRCode.toBuffer(uri, {
      width: 256,
      margin: 1,
      errorCorrectionLevel: 'M',
    });

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('UPI QR error:', err);
    return NextResponse.json({ error: 'QR generation failed' }, { status: 500 });
  }
}
