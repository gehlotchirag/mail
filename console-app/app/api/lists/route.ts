import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listMailingLists, createMailingList } from '@/lib/flux';
import { MAX_LIST_RECIPIENTS } from '@/lib/plans';
import { requireTeamAliasAccess, resolveOrgAddress, parseRecipients } from '@/lib/org';

/**
 * Shared team addresses (sales@, support@) that fan out to a set of recipients.
 *
 * Backed by the `x:MailingList` registry object on Flux: its address is indexed
 * like any mailbox, and SMTP expands a delivery to it into its `recipients`
 * (`RcptResolution::Expand`). Recipients are plain addresses, so a list can
 * include people outside the organisation.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const access = await requireTeamAliasAccess(session.orgId);
  if ('response' in access) return access.response;

  const lists = (await listMailingLists()).filter(l => access.domains.fluxIds.has(l.domainId));
  return NextResponse.json({
    maxRecipients: MAX_LIST_RECIPIENTS,
    lists: lists.map(l => ({
      id: l.id,
      address: l.emailAddress
        ?? `${l.name}@${access.domains.byFluxId.get(l.domainId)?.domain ?? l.domainId}`,
      description: l.description ?? null,
      recipients: l.recipients,
    })),
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as {
    address?: string; recipients?: unknown; description?: string;
  };
  if (!body.address) return NextResponse.json({ error: 'address is required' }, { status: 400 });

  const access = await requireTeamAliasAccess(session.orgId);
  if ('response' in access) return access.response;

  const resolved = resolveOrgAddress(body.address, access.domains);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });

  const parsed = parseRecipients(body.recipients);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const result = await createMailingList(
    resolved.localPart, resolved.domain.flux_domain_id, parsed.recipients, body.description
  );
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({
    id: result.id,
    address: `${resolved.localPart}@${resolved.domain.domain}`,
    recipients: parsed.recipients,
  }, { status: 201 });
}
