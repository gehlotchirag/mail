import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listMailingLists, updateMailingList, deleteMailingList } from '@/lib/flux';
import { requireTeamAliasAccess, parseRecipients, type OrgDomains } from '@/lib/org';

type Params = { params: Promise<{ id: string }> };

/**
 * Distribution lists live on the mail server, not in the console database, so
 * ownership has to be established by checking that the list sits on one of the
 * organisation's Flux domains before anything is changed.
 */
async function findOwnedList(id: string, domains: OrgDomains) {
  const lists = await listMailingLists();
  const list = lists.find(l => l.id === id);
  if (!list || !domains.fluxIds.has(list.domainId)) return null;
  return list;
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const access = await requireTeamAliasAccess(session.orgId);
  if ('response' in access) return access.response;

  const list = await findOwnedList(id, access.domains);
  if (!list) return NextResponse.json({ error: 'List not found' }, { status: 404 });

  const body = await req.json() as { recipients?: unknown; description?: string | null };

  let recipients: string[] | undefined;
  if (body.recipients !== undefined) {
    const parsed = parseRecipients(body.recipients);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    recipients = parsed.recipients;
  }
  if (recipients === undefined && body.description === undefined) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const result = await updateMailingList(id, { recipients, description: body.description });
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true, id, recipients: recipients ?? list.recipients });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const access = await requireTeamAliasAccess(session.orgId);
  if ('response' in access) return access.response;

  const list = await findOwnedList(id, access.domains);
  if (!list) return NextResponse.json({ error: 'List not found' }, { status: 404 });

  const result = await deleteMailingList(id);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true });
}
