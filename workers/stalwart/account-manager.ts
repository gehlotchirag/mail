const STALWART_URL = process.env.STALWART_URL ?? 'http://localhost:18080';
const ADMIN_AUTH = Buffer.from(
  `${process.env.STALWART_ADMIN_USER ?? 'admin@arhamfintech.ai'}:${process.env.STALWART_ADMIN_PASS ?? ''}`
).toString('base64');

const authHeader = () => ({ Authorization: `Basic ${ADMIN_AUTH}`, 'Content-Type': 'application/json' });

async function jmap(calls: unknown[][]): Promise<unknown[][]> {
  const res = await fetch(`${STALWART_URL}/jmap/`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail', 'urn:stalwart:jmap'], methodCalls: calls }),
  });
  if (!res.ok) throw new Error(`JMAP error: ${res.status}`);
  const data = await res.json() as { methodResponses: unknown[][] };
  return data.methodResponses;
}

export async function ensureAccountExists(email: string, displayName: string): Promise<string> {
  // Try to get accountId from JMAP session for this user
  const sessionRes = await fetch(`${STALWART_URL}/jmap/`, {
    headers: { Authorization: `Basic ${Buffer.from(`${email}:placeholder`).toString('base64')}` },
  });
  // If 200, user exists; extract accountId. If 401, need to create.
  if (sessionRes.ok) {
    const session = await sessionRes.json() as { primaryAccounts?: Record<string, string> };
    const accountId = Object.values(session.primaryAccounts ?? {})[0];
    if (accountId) return accountId;
  }

  // Create the account via Stalwart admin API
  const createRes = await fetch(`${STALWART_URL}/api/principal`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({
      type: 'individual',
      name: email.split('@')[0],
      email,
      displayName,
      secrets: [`migrated_${Math.random().toString(36).slice(2)}`],
    }),
  });
  if (!createRes.ok && createRes.status !== 409) {
    throw new Error(`Failed to create account ${email}: ${createRes.status} ${await createRes.text()}`);
  }

  // Fetch accountId after creation
  const sess2 = await fetch(`${STALWART_URL}/jmap/`, { headers: { ...authHeader() } });
  if (!sess2.ok) throw new Error(`Cannot get session after account creation for ${email}`);
  const s2 = await sess2.json() as { accounts?: Record<string, unknown> };
  return Object.keys(s2.accounts ?? {})[0] ?? email;
}

export async function resolveMailboxId(accountId: string, folderName: string, roleMap: Record<string, string>): Promise<string> {
  // Get all mailboxes for this account
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
