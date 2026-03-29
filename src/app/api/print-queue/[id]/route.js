import { NextResponse } from 'next/server';
import { getDb, getISTNow } from '@/lib/db';
import { requireAuthOrAgent } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const VALID_STATUSES = new Set(['printing', 'printed', 'failed']);

export async function PATCH(request, { params }) {
  try {
    const auth = requireAuthOrAgent(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id } = await params;
    const { status } = await request.json();

    if (!status || !VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const db = getDb();
    const job = db.prepare('SELECT id, status FROM print_queue WHERE id = ?').get(id);
    if (!job) {
      return NextResponse.json({ error: 'Print job nahi mila' }, { status: 404 });
    }

    const updates = { status };
    if (status === 'printed') {
      updates.printed_at = getISTNow();
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);

    db.prepare(`UPDATE print_queue SET ${setClauses} WHERE id = ?`).run(...values, id);

    return NextResponse.json({ id: Number(id), ...updates });
  } catch (err) {
    console.error('Print queue PATCH error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
