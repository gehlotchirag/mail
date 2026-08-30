import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  listAllUsers, listAccountsWithAliases, setAccountAliases, type FluxEmailAlias,
} from '@/lib/flux';
import { limitErrorResponse } from '@/lib/subscription';
import { MAX_ALIASES_PER_ACCOUNT } from '@/lib/plans';
import { requireTeamAliasAccess, resolveOrgAddress, type OrgDomains } from '@/lib/org';

/**
 * Extra deliverable addresses on an existing mailbox.
 *
 * Backed by `UserAccount.aliases` (`List<EmailAlias>`) on the Flux registry:
 * every alias is indexed alongside the account's primary address, so mail to it
 * lands in the same mailbox. An alias may sit on any verified domain the
 * organisation owns, not only the mailbox's own domain.
 */

/**
 * Plan gate plus the set of mailbox ids this organisation actually owns —
 * account ids come from the client, so every route has to prove the mailbox
 * sits on one of the org's Flux domains before touching it.
 */
async function requireAliasAccess(orgId: string): Promise<
  { domains: OrgDomains; accountIds: Set<string> } | { response: Response }
> {
  const access = await requireTeamAliasAccess(orgId);
  if ('response' in access) return access;

  const accounts = (await listAllUsers())
    .filter(u => u.domainId && access.domains.fluxIds.has(u.domainId));
  return { domains: access.domains, accountIds: new Set(accounts.map(a => a.id)) };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const access = await requireAliasAccess(session.orgId);
  if ('response' in access) return access.response;

  const accounts = await listAccountsWithAliases([...access.accountIds]);
  return NextResponse.json({
    maxAliasesPerAccount: MAX_ALIASES_PER_ACCOUNT,
    accounts: accounts.map(account => ({
      id: account.id,
      emailAddress: account.emailAddress,
      aliases: account.aliases.map(alias => ({
        address: `${alias.name}@${access.domains.byFluxId.get(alias.domainId)?.domain ?? alias.domainId}`,
        name: alias.name,
        domainId: alias.domainId,
        enabled: alias.enabled,
        description: alias.description,
      })),
    })),
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { accountId, address, description } = await req.json() as {
    accountId?: string; address?: string; description?: string;
  };
  if (!accountId || !address) {
    return NextResponse.json({ error: 'accountId and address are required' }, { status: 400 });
  }

  const access = await requireAliasAccess(session.orgId);
  if ('response' in access) return access.response;
  if (!access.accountIds.has(accountId)) {
    return NextResponse.json({ error: 'Mailbox not found' }, { status: 404 });
  }

  const resolved = resolveOrgAddress(address, access.domains);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });

  // Read-modify-write: the server compacts and re-sorts alias indices, so there
  // is no stable handle to patch a single entry by.
  const [account] = await listAccountsWithAliases([accountId]);
  if (!account) return NextResponse.json({ error: 'Mailbox not found' }, { status: 404 });

  const exists = account.aliases.some(
    a => a.name === resolved.localPart && a.domainId === resolved.domain.flux_domain_id
  );
  if (exists) return NextResponse.json({ error: 'That alias already exists' }, { status: 409 });

  if (account.aliases.length >= MAX_ALIASES_PER_ACCOUNT) {
    return limitErrorResponse(
      `A mailbox can have at most ${MAX_ALIASES_PER_ACCOUNT} aliases.`
    );
  }

  const alias: FluxEmailAlias = {
    enabled: true,
    name: resolved.localPart,
    domainId: resolved.domain.flux_domain_id,
    description: description ?? null,
  };
  const result = await setAccountAliases(accountId, [...account.aliases, alias]);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({
    accountId,
    address: `${resolved.localPart}@${resolved.domain.domain}`,
  }, { status: 201 });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const accountId = params.get('accountId');
  const address = params.get('address');
  if (!accountId || !address) {
    return NextResponse.json({ error: 'accountId and address are required' }, { status: 400 });
  }

  const access = await requireAliasAccess(session.orgId);
  if ('response' in access) return access.response;
  if (!access.accountIds.has(accountId)) {
    return NextResponse.json({ error: 'Mailbox not found' }, { status: 404 });
  }

  const resolved = resolveOrgAddress(address, access.domains);
  if ('error' in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });

  const [account] = await listAccountsWithAliases([accountId]);
  if (!account) return NextResponse.json({ error: 'Mailbox not found' }, { status: 404 });

  const remaining = account.aliases.filter(
    a => !(a.name === resolved.localPart && a.domainId === resolved.domain.flux_domain_id)
  );
  if (remaining.length === account.aliases.length) {
    return NextResponse.json({ error: 'Alias not found' }, { status: 404 });
  }

  const result = await setAccountAliases(accountId, remaining);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true });
}
