import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function csvEscape(value) {
  let str = value == null ? '' : String(value);
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
}

// Admin: customers with visits, spend (net of returns) and last visit.
// ?q= searches name or phone; ?format=csv downloads the full list.
export async function GET(request) {
  try {
    const result = requireAdmin(request);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim().slice(0, 50);
    const format = searchParams.get('format');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = 30;

    const where = [];
    const params = [];
    if (q) {
      where.push('(c.name LIKE ? OR c.phone LIKE ?)');
      params.push(`%${q}%`, `%${q.replace(/\D/g, '') || q}%`);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const baseQuery = `
      SELECT c.id, c.phone, c.name, c.first_seen_at,
             COUNT(CASE WHEN b.type = 'sale' THEN 1 END) AS visits,
             COALESCE(SUM(CASE WHEN b.type = 'sale' THEN b.total WHEN b.type = 'return' THEN -b.total END), 0) AS spend,
             MAX(CASE WHEN b.type = 'sale' THEN b.created_at END) AS last_visit
      FROM customers c
      LEFT JOIN bills b ON b.customer_id = c.id AND b.deleted_at IS NULL
      ${whereClause}
      GROUP BY c.id
      ORDER BY last_visit DESC, c.id DESC
    `;

    const db = getDb();

    if (format === 'csv') {
      const rows = db.prepare(baseQuery).all(...params);
      const lines = [['Phone', 'Name', 'Visits', 'Spend', 'Last visit', 'First visit'].map(csvEscape).join(',')];
      for (const r of rows) {
        lines.push([r.phone, r.name || '', r.visits, Math.round(r.spend * 100) / 100, r.last_visit || '', r.first_seen_at || '']
          .map(csvEscape).join(','));
      }
      return new Response(lines.join('\n'), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="masterji-customers.csv"',
        },
      });
    }

    const total = db.prepare(`SELECT COUNT(*) AS n FROM customers c ${whereClause}`).get(...params).n;
    const customers = db.prepare(`${baseQuery} LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
    return NextResponse.json({ customers, pagination: { page, pages: Math.max(1, Math.ceil(total / limit)), total } });
  } catch (err) {
    console.error('Customers list error:', err);
    return NextResponse.json({ error: 'Customers load karne mein gadbad' }, { status: 500 });
  }
}
