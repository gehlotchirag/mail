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

export async function listUsersForDomain(fluxDomainId: string): Promise<FluxUser[]> {
  const responses = await jmap([['x:Account/query', {}, 'q']]);
  const ids: string[] = [];
  for (const [method, result] of responses as Array<[string, { ids?: string[] }]>) {
    if (method === 'x:Account/query') ids.push(...(result.ids ?? []));
  }
  const users: FluxUser[] = [];
  for (const id of ids) {
    try {
      const resp = await jmap([
        ['x:Account/get', { ids: [id], properties: ['id', 'name', 'emailAddress', 'description', 'domainId'] }, 'g'],
      ]);
      for (const [method, result] of resp as Array<[string, { list?: Array<FluxUser & { domainId?: string }> }]>) {
        if (method === 'x:Account/get' && result.list?.length) {
          const u = result.list[0];
          if (u.emailAddress && u.domainId === fluxDomainId) users.push(u);
        }
      }
    } catch { /* skip */ }
  }
  return users;
}

export async function createUser(
  name: string, domainId: string, password: string, description?: string
): Promise<{ id: string } | { error: string }> {
  const responses = await jmap([
    ['x:Account/set', {
      create: {
        new: {
          '@type': 'User', name, domainId,
          description: description ?? '',
          credentials: { 0: { '@type': 'Password', secret: password } },
          roles: { '@type': 'User' },
        },
      },
    }, 'c'],
  ]);
  for (const [method, result] of responses as Array<[string, {
    created?: Record<string, { id: string }>;
    notCreated?: Record<string, { description?: string }>;
  }]>) {
    if (method === 'x:Account/set') {
      if (result.notCreated?.new) return { error: result.notCreated.new.description ?? 'Creation failed' };
      const id = result.created?.new?.id;
      if (id) return { id };
    }
  }
  return { error: 'Unexpected response' };
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
