const JMAP_URL = process.env.JMAP_URL ?? 'http://localhost:8080';
const AUTH = process.env.JMAP_ADMIN_AUTH ?? `Basic ${Buffer.from('admin:FluxAdmin2026!').toString('base64')}`;

async function jmap(calls: unknown[][]): Promise<unknown[][]> {
  const res = await fetch(`${JMAP_URL}/jmap/`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'], methodCalls: calls }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`JMAP ${res.status}: ${res.statusText}`);
  const data = await res.json() as { methodResponses: unknown[][] };
  return data.methodResponses;
}

export interface FluxUser {
  id: string;
  name: string;
  emailAddress: string;
  description?: string;
  domainId?: string;
}

export async function addDomain(domain: string): Promise<{ id: string } | { error: string }> {
  const responses = await jmap([
    ['x:Domain/set', { create: { new: { name: domain } } }, 'c'],
  ]);
  for (const [method, result] of responses as Array<[string, {
    created?: Record<string, { id: string }>;
    notCreated?: Record<string, { description?: string }>;
  }]>) {
    if (method === 'x:Domain/set') {
      if (result.notCreated?.new) {
        const desc = result.notCreated.new.description ?? '';
        // If already exists, query for the ID
        if (desc.toLowerCase().includes('already') || desc.toLowerCase().includes('exist')) {
          const existing = await getDomainId(domain);
          if (existing) return { id: existing };
        }
        return { error: desc || 'Failed to add domain' };
      }
      const id = result.created?.new?.id;
      if (id) return { id };
    }
  }
  return { error: 'Unexpected response' };
}

export async function removeDomain(fluxDomainId: string): Promise<{ error?: string }> {
  const responses = await jmap([
    ['x:Domain/set', { destroy: [fluxDomainId] }, 'd'],
  ]);
  for (const [method, result] of responses as Array<[string, {
    notDestroyed?: Record<string, { description?: string }>;
  }]>) {
    if (method === 'x:Domain/set' && result.notDestroyed?.[fluxDomainId]) {
      return { error: result.notDestroyed[fluxDomainId].description ?? 'Delete failed' };
    }
  }
  return {};
}

async function getDomainId(domain: string): Promise<string | null> {
  const responses = await jmap([
    ['x:Domain/query', {}, 'q'],
    ['x:Domain/get', { '#ids': { resultOf: 'q', name: 'x:Domain/query', path: '/ids' }, properties: ['id', 'name'] }, 'g'],
  ]);
  for (const [method, result] of responses as Array<[string, { list?: Array<{ id: string; name: string }> }]>) {
    if (method === 'x:Domain/get') {
      const d = result.list?.find(x => x.name === domain);
      if (d) return d.id;
    }
  }
  return null;
}

const ACCOUNT_PROPERTIES = ['id', 'name', 'emailAddress', 'description', 'domainId'];

/**
 * Every account on the server, fetched in a single round-trip using a
 * back-reference from x:Account/query into x:Account/get. Falls back to
 * fetching one id at a time (skipping accounts that error) if the batched get
 * does not come back with a list.
 *
 * Callers that need more than one domain should call this ONCE and filter,
 * rather than calling listUsersForDomain per domain.
 */
export async function listAllUsers(): Promise<FluxUser[]> {
  let ids: string[] = [];
  let batched: FluxUser[] | null = null;

  try {
    const responses = await jmap([
      ['x:Account/query', {}, 'q'],
      ['x:Account/get', {
        '#ids': { resultOf: 'q', name: 'x:Account/query', path: '/ids' },
        properties: ACCOUNT_PROPERTIES,
      }, 'g'],
    ]);
    for (const [method, result] of responses as Array<[string, { ids?: string[]; list?: FluxUser[] }]>) {
      if (method === 'x:Account/query') ids = result.ids ?? [];
      if (method === 'x:Account/get' && result.list) batched = result.list;
    }
  } catch {
    batched = null;
  }

  if (batched) return batched.filter(u => u.emailAddress);

  // Fallback: the batched get failed (or the server rejected the
  // back-reference) — fetch ids individually and skip the ones that error.
  if (!ids.length) {
    try {
      const responses = await jmap([['x:Account/query', {}, 'q']]);
      for (const [method, result] of responses as Array<[string, { ids?: string[] }]>) {
        if (method === 'x:Account/query') ids = result.ids ?? [];
      }
    } catch {
      return [];
    }
  }

  const users: FluxUser[] = [];
  for (const id of ids) {
    try {
      const resp = await jmap([
        ['x:Account/get', { ids: [id], properties: ACCOUNT_PROPERTIES }, 'g'],
      ]);
      for (const [method, result] of resp as Array<[string, { list?: FluxUser[] }]>) {
        if (method === 'x:Account/get' && result.list?.length) {
          const u = result.list[0];
          if (u.emailAddress) users.push(u);
        }
      }
    } catch { /* skip */ }
  }
  return users;
}

export async function listUsersForDomain(fluxDomainId: string): Promise<FluxUser[]> {
  const users = await listAllUsers();
  return users.filter(u => u.domainId === fluxDomainId);
}

/**
 * Total account count across a set of Flux domain ids — one JMAP round-trip
 * regardless of how many domains the organisation owns.
 */
export async function countUsersForDomains(fluxDomainIds: string[]): Promise<number> {
  if (!fluxDomainIds.length) return 0;
  const wanted = new Set(fluxDomainIds);
  const users = await listAllUsers();
  return users.filter(u => u.domainId && wanted.has(u.domainId)).length;
}

/**
 * Flux/Stalwart stores per-account limits in the `quotas` map of the UserAccount
 * object; `maxDiskQuota` is the total mailbox+blob size in bytes (0 = unlimited).
 * It can be supplied on create or patched later via `quotas/maxDiskQuota`.
 */
const DISK_QUOTA_PROPERTY = 'quotas/maxDiskQuota';

async function createAccount(
  name: string, domainId: string, password: string, description: string, quotaBytes?: number
): Promise<{ id: string } | { error: string }> {
  const account: Record<string, unknown> = {
    '@type': 'User', name, domainId,
    description,
    credentials: { 0: { '@type': 'Password', secret: password } },
    roles: { '@type': 'User' },
  };
  if (quotaBytes && quotaBytes > 0) account.quotas = { maxDiskQuota: quotaBytes };

  const responses = await jmap([['x:Account/set', { create: { new: account } }, 'c']]);
  for (const [method, result] of responses as Array<[string, {
    created?: Record<string, { id: string }>;
    notCreated?: Record<string, { description?: string }>;
    type?: string;
    description?: string;
  }]>) {
    // A method-level failure (e.g. an unknown property) comes back as 'error'.
    if (method === 'error') {
      return { error: result.description ?? result.type ?? 'Request failed' };
    }
    if (method === 'x:Account/set') {
      if (result.notCreated?.new) return { error: result.notCreated.new.description ?? 'Creation failed' };
      const id = result.created?.new?.id;
      if (id) return { id };
    }
  }
  return { error: 'Unexpected response' };
}

/**
 * Creates a mail account, applying the plan's per-user disk quota.
 *
 * If the server rejects the create because of the quota property (older build
 * without `quotas` on the account object), the account is created without it
 * and the quota is applied as a follow-up patch. `quotaApplied` reports whether
 * the quota actually made it onto the account.
 */
export async function createUser(
  name: string, domainId: string, password: string, description?: string, quotaBytes?: number
): Promise<{ id: string; quotaApplied: boolean } | { error: string }> {
  const desc = description ?? '';
  const wantsQuota = !!quotaBytes && quotaBytes > 0;

  const result = await createAccount(name, domainId, password, desc, quotaBytes);
  if (!('error' in result)) return { id: result.id, quotaApplied: wantsQuota };
  // Only retry if the failure looks like the server rejecting the property
  // itself — anything else (duplicate account, bad domain) is a real error.
  const rejectedProperty = /quota|invalidArgument|invalid propert|unknown propert|unexpected response/i;
  if (!wantsQuota || !rejectedProperty.test(result.error)) return result;

  // Quota rejected at create time — create the account, then try to patch it.
  console.warn(`[flux] Account create rejected the quota property (${result.error}); retrying without it`);
  const retry = await createAccount(name, domainId, password, desc);
  if ('error' in retry) return retry;

  const quota = await setAccountQuota(retry.id, quotaBytes!);
  if (quota.error) {
    console.error(`[flux] Could not set disk quota on account ${retry.id}: ${quota.error}`);
    return { id: retry.id, quotaApplied: false };
  }
  return { id: retry.id, quotaApplied: true };
}

/** Sets the account's total disk quota in bytes (0 = unlimited). */
export async function setAccountQuota(id: string, quotaBytes: number): Promise<{ error?: string }> {
  const responses = await jmap([
    ['x:Account/set', { update: { [id]: { [DISK_QUOTA_PROPERTY]: quotaBytes } } }, 'u'],
  ]);
  for (const [method, result] of responses as Array<[string, {
    notUpdated?: Record<string, { description?: string }>;
  }]>) {
    if (method === 'x:Account/set' && result.notUpdated?.[id]) {
      return { error: result.notUpdated[id].description ?? 'Quota update failed' };
    }
  }
  return {};
}

export async function deleteUser(id: string): Promise<{ error?: string }> {
  const responses = await jmap([['x:Account/set', { destroy: [id] }, 'd']]);
  for (const [method, result] of responses as Array<[string, {
    notDestroyed?: Record<string, { description?: string }>;
  }]>) {
    if (method === 'x:Account/set' && result.notDestroyed?.[id]) {
      return { error: result.notDestroyed[id].description ?? 'Delete failed' };
    }
  }
  return {};
}

export async function resetPassword(id: string, password: string): Promise<{ error?: string }> {
  const responses = await jmap([
    ['x:Account/set', { update: { [id]: { 'credentials/0/secret': password } } }, 'u'],
  ]);
  for (const [method, result] of responses as Array<[string, {
    notUpdated?: Record<string, { description?: string }>;
  }]>) {
    if (method === 'x:Account/set' && result.notUpdated?.[id]) {
      return { error: result.notUpdated[id].description ?? 'Reset failed' };
    }
  }
  return {};
}
