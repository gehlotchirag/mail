import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { deleteUser, resetPassword } from '@/lib/flux';
import { requireOwnedMailbox } from '@/lib/org';
import { rateLimit } from '@/lib/rate-limit';

type Params = { params: Promise<{ id: string }> };

/**
 * Both handlers take an account id straight from the URL, and account ids are a
 * single global namespace shared by every tenant on the mail server — so a
 * session alone establishes nothing about who may touch this mailbox.
 * `requireOwnedMailbox` proves it sits on one of the caller's own domains.
 *
 * A miss answers 404, not 403, matching the rest of the API: a tenant should
 * not be able to tell another tenant's mailbox apart from one that never
 * existed. The rate limit is keyed on the organisation rather than the IP
 * because it exists to blunt id enumeration by an authenticated caller.
 */
const MUTATIONS_PER_MINUTE = 20;

async function authorize(id: string) {
  const session = await getSession();
  if (!session) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const { allowed } = rateLimit(`mailbox-mutate:${session.orgId}`, MUTATIONS_PER_MINUTE, 60_000);
  if (!allowed) {
    return {
      response: NextResponse.json(
        { error: 'Too many mailbox changes. Try again in a minute.' },
        { status: 429 }
      ),
    };
  }

  const mailbox = await requireOwnedMailbox(session.orgId, id);
  if (!mailbox) {
    return { response: NextResponse.json({ error: 'Mailbox not found' }, { status: 404 }) };
  }
  return { mailbox };
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const auth = await authorize(id);
  if ('response' in auth) return auth.response;

  const result = await deleteUser(id);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const auth = await authorize(id);
  if ('response' in auth) return auth.response;

  const { password } = await req.json() as { password?: string };
  if (!password) return NextResponse.json({ error: 'password required' }, { status: 400 });

  const result = await resetPassword(id, password);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
