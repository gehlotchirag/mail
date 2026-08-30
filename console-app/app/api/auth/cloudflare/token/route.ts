import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const jar = await cookies();
  const raw = jar.get('cf_pending')?.value;
  if (!raw) return NextResponse.json({ token: null });

  let data: unknown;
  try { data = JSON.parse(raw); } catch { return NextResponse.json({ token: null }); }

  const res = NextResponse.json({ token: data });
  res.cookies.delete('cf_pending');
  return res;
}
