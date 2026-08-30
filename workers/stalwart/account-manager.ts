// Flux mail server uses JMAP x: extension methods for all admin operations.
// REST /api/principal does NOT exist in this build.

const FLUX_URL = process.env.STALWART_URL ?? 'http://localhost:18080';
const ADMIN_AUTH = Buffer.from(
  `${process.env.STALWART_ADMIN_USER ?? 'admin@arhamfintech.ai'}:${process.env.STALWART_ADMIN_PASS ?? ''}`
).toString('base64');

// Every cached Flux ID expires: accounts and mailboxes can be deleted and
// recreated with a different ID while a worker process stays alive.
const CACHE_TTL_MS = Number(process.env.FLUX_CACHE_TTL_MS ?? 300_000);

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

/** True when any method in the batch came back as a JMAP-level error. */
function hasMethodError(responses: unknown[][]): string | null {
  for (const [method, result] of responses as Array<[string, { type?: string; description?: string }]>) {
    if (method === 'error') return result?.type ?? result?.description ?? 'unknown';
  }
  return null;
}

// ── TTL caches ────────────────────────────────────────────────────────────────

class TtlCache<T> {
  private entries = new Map<string, { value: T; expiresAt: number }>();
  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): T {
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }
}

// domain name → flux ID (e.g. "arhamfintech.ai" → "b")
const domainIdCache = new TtlCache<string>(CACHE_TTL_MS);
// email → flux account ID
const accountIdCache = new TtlCache<string>(CACHE_TTL_MS);
// flux account ID → that account's mailboxes
type MailboxRow = { id: string; name: string; role?: string };
const mailboxCache = new TtlCache<MailboxRow[]>(CACHE_TTL_MS);

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ── Domains ───────────────────────────────────────────────────────────────────

async function getDomainId(domain: string): Promise<string> {
  const key = normalizeEmail(domain);
  const cached = domainIdCache.get(key);
  if (cached) return cached;

  // x:Domain indexes "name" as a unique key, so the server can resolve this
  // directly instead of returning every domain on the box.
  const responses = await jmap([
    ['x:Domain/query', { filter: { name: key } }, 'q'],
    ['x:Domain/get', { '#ids': { resultOf: 'q', name: 'x:Domain/query', path: '/ids' }, properties: ['id', 'name'] }, 'g'],
  ]);

  const filterError = hasMethodError(responses);
  if (filterError) {
    console.warn(`[flux] x:Domain/query filter rejected (${filterError}) — falling back to full domain list`);
    return getDomainIdUnfiltered(key);
  }

  for (const [method, result] of responses as Array<[string, { list?: Array<{ id: string; name: string }> }]>) {
    if (method === 'x:Domain/get') {
      for (const d of result.list ?? []) domainIdCache.set(normalizeEmail(d.name), d.id);
    }
  }

  const id = domainIdCache.get(key);
  if (!id) throw new Error(`Domain "${domain}" not found in Flux server. Add it via the admin panel first.`);
  return id;
}

/** Fallback for builds that reject filtered domain queries. */
async function getDomainIdUnfiltered(domain: string): Promise<string> {
  const responses = await jmap([
    ['x:Domain/query', {}, 'q'],
    ['x:Domain/get', { '#ids': { resultOf: 'q', name: 'x:Domain/query', path: '/ids' }, properties: ['id', 'name'] }, 'g'],
  ]);
  for (const [method, result] of responses as Array<[string, { list?: Array<{ id: string; name: string }> }]>) {
    if (method === 'x:Domain/get') {
      for (const d of result.list ?? []) domainIdCache.set(normalizeEmail(d.name), d.id);
    }
  }
  const id = domainIdCache.get(domain);
  if (!id) throw new Error(`Domain "${domain}" not found in Flux server. Add it via the admin panel first.`);
  return id;
}

// ── Accounts ──────────────────────────────────────────────────────────────────

// Set once a filtered x:Account/query has been rejected by this server, so we
// stop paying for the failed round-trip on every subsequent lookup.
let accountFilterSupported = true;

async function findAccountByEmail(email: string): Promise<string | null> {
  const key = normalizeEmail(email);
  const cached = accountIdCache.get(key);
  if (cached) return cached;

  const [localPart, domain] = key.split('@');
  if (localPart && domain && accountFilterSupported) {
    const id = await findAccountFiltered(localPart, domain);
    if (id !== undefined) return id;
  }

  return findAccountUnfiltered(key);
}

/**
 * Server-side lookup. x:Account indexes "name" (keyword) and "domainId" (id),
 * and Flux derives emailAddress as `name@domain`, so filtering on both is
 * equivalent to filtering on the address itself — only AND is supported.
 *
 * Returns `undefined` when the server rejected the filter (caller falls back).
 */
async function findAccountFiltered(localPart: string, domain: string): Promise<string | null | undefined> {
  let domainId: string;
  try {
    domainId = await getDomainId(domain);
  } catch {
    return undefined; // unknown domain — let the full scan decide
  }

  const responses = await jmap([
    ['x:Account/query', {
      filter: { operator: 'AND', conditions: [{ name: localPart }, { domainId }] },
    }, 'q'],
    ['x:Account/get', { '#ids': { resultOf: 'q', name: 'x:Account/query', path: '/ids' }, properties: ['id', 'emailAddress'] }, 'g'],
  ]);

  const filterError = hasMethodError(responses);
  if (filterError) {
    accountFilterSupported = false;
    console.warn(`[flux] x:Account/query filter rejected (${filterError}) — falling back to full account list`);
    return undefined;
  }

  for (const [method, result] of responses as Array<[string, { list?: Array<{ id: string; emailAddress?: string }> }]>) {
    if (method === 'x:Account/get') {
      for (const a of result.list ?? []) {
        if (a.emailAddress) accountIdCache.set(normalizeEmail(a.emailAddress), a.id);
      }
    }
  }

  return accountIdCache.get(`${localPart}@${domain}`) ?? null;
}

/** Legacy path: pull every account once and cache the lot under the same TTL. */
async function findAccountUnfiltered(key: string): Promise<string | null> {
  const responses = await jmap([
    ['x:Account/query', {}, 'q'],
    ['x:Account/get', { '#ids': { resultOf: 'q', name: 'x:Account/query', path: '/ids' }, properties: ['id', 'emailAddress'] }, 'g'],
  ]);
  for (const [method, result] of responses as Array<[string, { list?: Array<{ id: string; emailAddress?: string }> }]>) {
    if (method === 'x:Account/get') {
      for (const a of result.list ?? []) {
        if (a.emailAddress) accountIdCache.set(normalizeEmail(a.emailAddress), a.id);
      }
    }
  }
  return accountIdCache.get(key) ?? null;
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
          accountIdCache.delete(normalizeEmail(email));
          const retry = await findAccountByEmail(email);
          if (retry) return retry;
        }
        throw new Error(`Failed to create account ${email}: ${err.description ?? JSON.stringify(err)}`);
      }
      const id = result.created?.new?.id;
      if (id) {
        accountIdCache.set(normalizeEmail(email), id);
        // A brand-new account cannot have stale mailboxes cached against it.
        mailboxCache.delete(id);
        return id;
      }
    }
  }
  throw new Error(`Unexpected response creating account ${email}`);
}

// ── Mailboxes ─────────────────────────────────────────────────────────────────

/** Mailbox/get has no address filter, so fetch once per account and cache. */
async function getMailboxes(accountId: string): Promise<MailboxRow[]> {
  const cached = mailboxCache.get(accountId);
  if (cached) return cached;

  const responses = await jmap([
    ['Mailbox/get', { accountId, ids: null }, 'a'],
  ]);
  const [, result] = (responses[0] ?? []) as [string, { list?: MailboxRow[] }];
  return mailboxCache.set(accountId, result?.list ?? []);
}

export async function resolveMailboxId(accountId: string, folderName: string, roleMap: Record<string, string>): Promise<string> {
  const mailboxes = await getMailboxes(accountId);

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
  if (!newId) {
    // Another worker may have created it concurrently — re-read before failing.
    mailboxCache.delete(accountId);
    const fresh = await getMailboxes(accountId);
    const raced = fresh.find(m => m.name === folderName || m.name === folderName.split('/').pop());
    if (raced) return raced.id;
    throw new Error(`Failed to create mailbox ${folderName} for account ${accountId}`);
  }

  mailboxes.push({ id: newId, name: folderName });
  return newId;
}
