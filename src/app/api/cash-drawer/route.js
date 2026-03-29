import { NextResponse } from 'next/server';
import { getDb, getCashDrawer, setCashDrawer } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export async function GET(request) {
  try {
    const result = requireAuth(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const db = getDb();
    return NextResponse.json({ cash_drawer: getCashDrawer(db) });
  } catch (err) {
    console.error('Cash drawer get error:', err);
    return NextResponse.json({ error: 'Cash drawer load karne mein gadbad' }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const result = requireAuth(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    if (result.user.role !== 'admin') {
      return NextResponse.json({ error: 'Sirf admin cash drawer set kar sakta hai' }, { status: 403 });
    }

    const body = await request.json();
    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: 'Amount 0 ya usse zyada hona chahiye' }, { status: 400 });
    }

    const db = getDb();
    setCashDrawer(db, amount);

    return NextResponse.json({ message: 'Cash drawer set ho gaya', cash_drawer: amount });
  } catch (err) {
    console.error('Cash drawer set error:', err);
    return NextResponse.json({ error: 'Cash drawer set karne mein gadbad' }, { status: 500 });
  }
}
