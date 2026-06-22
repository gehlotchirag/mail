// Flux mail server uses JMAP x: extension methods for all admin operations.
// REST /api/principal does NOT exist in this build.

const FLUX_URL = process.env.STALWART_URL ?? 'http://localhost:18080';
const ADMIN_AUTH = Buffer.from(
  `${process.env.STALWART_ADMIN_USER ?? 'admin@arhamfintech.ai'}:${process.env.STALWART_ADMIN_PASS ?? ''}`
).toString('base64');

function adminHeaders() {
  return { Authorization: `Basic ${ADMIN_AUTH}`, 'Content-Type': 'application/json' };
}

async function jmap(calls: unknown[][]): Promise<unknown[][]> {
  const res = await fetch(`${FLUX_URL}/jmap/`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
      methodCalls: calls,
    }),
  });
  if (!res.ok) throw new Error(`JMAP error: ${res.status} ${res.statusText}`);
  const data = await res.json() as { methodResponses: unknown[][] };
  return data.methodResponses;
}

// Cache domain name → flux ID (e.g. "arhamfintech.ai" → "b")
const domainIdCache = new Map<string, string>();

async function getDomainId(domain: string): Promise<string> {
  if (domainIdCache.has(domain)) return domainIdCache.get(domain)!;

  const responses = await jmap([
    ['x:Domain/query', {}, 'q'],
    ['x:Domain/get', { '#ids': { resultOf: 'q', name: 'x:Domain/query', path: '/ids' }, properties: ['id', 'name'] }, 'g'],
  ]);
  for (const [method, result] of responses as Array<[string, { list?: Array<{ id: string; name: string }> }]>) {
    if (method === 'x:Domain/get') {
      for (const d of result.list ?? []) {
        domainIdCache.set(d.name, d.id);
      }
    }
  }

  const id = domainIdCache.get(domain);
  if (!id) throw new Error(`Domain "${domain}" not found in Flux server. Add it via the admin panel first.`);
  return id;
}

// Cache email → flux account ID
const accountIdCache = new Map<string, string>();

async function findAccountByEmail(email: string): Promise<string | null> {
  if (accountIdCache.has(email)) return accountIdCache.get(email)!;

  // Get all accounts and find by emailAddress
  const responses = await jmap([
    ['x:Account/query', {}, 'q'],
    ['x:Account/get', { '#ids': { resultOf: 'q', name: 'x:Account/query', path: '/ids' }, properties: ['id', 'emailAddress'] }, 'g'],
  ]);
  for (const [method, result] of responses as Array<[string, { list?: Array<{ id: string; emailAddress?: string }> }]>) {
    if (method === 'x:Account/get') {
      for (const a of result.list ?? []) {
        if (a.emailAddress) accountIdCache.set(a.emailAddress, a.id);
      }
    }
  }

  return accountIdCache.get(email) ?? null;
}

export async function ensureAccountExists(email: string, _displayName: string): Promise<string> {
  // Check if already exists
  const existing = await findAccountByEmail(email);
  if (existing) return existing;

  // Determine domain
  const domain = email.split('@')[1];
  if (!domain) throw new Error(`Invalid email: ${email}`);
  const domainId = await getDomainId(domain);
  const name = email.split('@')[0];
  const tempPassword = `Migrated_${Math.random().toString(36).slice(2, 10)}!`;

  // Create via x:Account/set
  const responses = await jmap([
    ['x:Account/set', {
      create: {
        new: {
          '@type': 'User',
          name,
          domainId,
          description: 'Migrated account',
          credentials: { 0: { '@type': 'Password', secret: tempPassword } },
          roles: { '@type': 'User' },
        },
      },
    }, 'c'],
  ]);

  for (const [method, result] of responses as Array<[string, { created?: Record<string, { id: string }>; notCreated?: Record<string, unknown> }]>) {
    if (method === 'x:Account/set') {
      if (result.notCreated?.new) {
        const err = result.notCreated.new as { description?: string };
        // Could be alreadyExists if there's a race; re-query
        if (JSON.stringify(err).includes('already')) {
          const retry = await findAccountByEmail(email);
          if (retry) return retry;
        }
        throw new Error(`Failed to create account ${email}: ${err.description ?? JSON.stringify(err)}`);
      }
      const id = result.created?.new?.id;
      if (id) {
        accountIdCache.set(email, id);
        return id;
      }
    }
  }
  throw new Error(`Unexpected response creating account ${email}`);
}

export async function resolveMailboxId(accountId: string, folderName: string, roleMap: Record<string, string>): Promise<string> {
  const responses = await jmap([
    ['Mailbox/get', { accountId, ids: null }, 'a'],
  ]);
  const [, result] = (responses[0] ?? []) as [string, { list?: Array<{ id: string; name: string; role?: string }> }];
  const mailboxes = result?.list ?? [];

  // Match by role first
  const targetRole = roleMap[folderName];
  if (targetRole) {
    const byRole = mailboxes.find(m => m.role === targetRole);
    if (byRole) return byRole.id;
  }

  // Match by name
  const byName = mailboxes.find(m => m.name === folderName || m.name === folderName.split('/').pop());
  if (byName) return byName.id;

  // Create new mailbox
  const createResponses = await jmap([
    ['Mailbox/set', { accountId, create: { '1': { name: folderName } } }, 'b'],
  ]);
  const [, createResult] = (createResponses[0] ?? []) as [string, { created?: Record<string, { id: string }> }];
  const newId = createResult?.created?.['1']?.id;
  if (!newId) throw new Error(`Failed to create mailbox ${folderName} for account ${accountId}`);
  return newId;
}
