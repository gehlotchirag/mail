import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { deleteUser, resetPassword } from '@/lib/flux';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const result = await deleteUser(id);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { password } = await req.json() as { password?: string };
  if (!password) return NextResponse.json({ error: 'password required' }, { status: 400 });
  const result = await resetPassword(id, password);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
