import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAuth, requireAdmin } from '@/lib/auth';

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
    const categories = db.prepare(
      `SELECT id, name, group_name, active, display_order FROM categories WHERE ${whereClause} ORDER BY display_order, name`
    ).all();

    const grouped = {};
    for (const c of categories.filter(c => c.active)) {
      if (!grouped[c.group_name]) grouped[c.group_name] = [];
      grouped[c.group_name].push(c);
    }

    return NextResponse.json({ categories, grouped });
  } catch (err) {
    console.error('Categories error:', err);
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
    const { name, group_name } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Category ka naam zaroori hai' }, { status: 400 });
    }

    if (!['women', 'men', 'kids', 'other'].includes(group_name)) {
      return NextResponse.json({ error: 'Group women, men, kids ya other hona chahiye' }, { status: 400 });
    }

    const db = getDb();

    const existing = db.prepare('SELECT id FROM categories WHERE name = ? AND group_name = ?').get(name.trim(), group_name);
    if (existing) {
      return NextResponse.json({ error: 'Ye category already hai' }, { status: 400 });
    }

    const maxOrder = db.prepare('SELECT MAX(display_order) as max_order FROM categories').get();
    const nextOrder = (maxOrder?.max_order || 0) + 1;

    const info = db.prepare(
      'INSERT INTO categories (name, group_name, display_order) VALUES (?, ?, ?)'
    ).run(name.trim(), group_name, nextOrder);

    return NextResponse.json({
      message: 'Category add ho gayi',
      id: info.lastInsertRowid,
    }, { status: 201 });

  } catch (err) {
    console.error('Create category error:', err);
    return NextResponse.json({ error: 'Category banane mein gadbad' }, { status: 500 });
  }
}
