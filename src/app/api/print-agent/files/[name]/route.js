import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireAdminOrAgent } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// The shop PC's update.py downloads new agent versions from here, so the
// GitHub repo can stay private. Only these files are ever served.
const ALLOWED = new Set(['agent.py', 'update.py', 'start.bat']);

export async function GET(request, { params }) {
  const auth = requireAdminOrAgent(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { name } = await params;
  if (!ALLOWED.has(name)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  try {
    const data = fs.readFileSync(path.join(process.cwd(), 'print-agent', name));
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('Print agent file error:', err);
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
