import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cookieJar = await cookies();
  const raw = cookieJar.get('zoho_pending')?.value;
  if (!raw) return NextResponse.json({ tokens: null });

  let tokens: unknown;
  try { tokens = JSON.parse(raw); } catch { return NextResponse.json({ tokens: null }); }

  const res = NextResponse.json({ tokens });
  res.cookies.delete('zoho_pending');
  return res;
}
