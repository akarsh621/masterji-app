import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

export async function GET(request) {
  const result = requireAuth(request);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    user: result.user,
    db_mode: process.env.DB_MODE === 'dev' ? 'dev' : 'prod',
  });
}
