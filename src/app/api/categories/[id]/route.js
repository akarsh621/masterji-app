import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  try {
    const result = requireAdmin(request);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request data galat hai' }, { status: 400 });
    }
    const db = getDb();

    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!cat) {
      return NextResponse.json({ error: 'Category nahi mili' }, { status: 404 });
    }

    if (body.name !== undefined) {
      db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(body.name.trim(), id);
    }
    if (body.group_name !== undefined) {
      if (!['women', 'men', 'kids', 'other'].includes(body.group_name)) {
        return NextResponse.json({ error: 'Group women, men, kids ya other hona chahiye' }, { status: 400 });
      }
      db.prepare('UPDATE categories SET group_name = ? WHERE id = ?').run(body.group_name, id);
    }
    if (body.active !== undefined) {
      db.prepare('UPDATE categories SET active = ? WHERE id = ?').run(body.active ? 1 : 0, id);
    }

    return NextResponse.json({ message: 'Category update ho gayi' });
  } catch (err) {
    console.error('Update category error:', err);
    return NextResponse.json({ error: 'Category update karne mein gadbad' }, { status: 500 });
  }
}
