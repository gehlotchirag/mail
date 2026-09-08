import { randomBytes } from 'crypto';
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
      using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail', 'urn:stalwart:jmap'],
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

/**
 * Character set for generated passwords. Excludes I/O/l/0/1 so a password read off
 * a CSV or dictated over a phone cannot be mistyped.
 */
const PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function randomChars(n: number): string {
  // Rejection sampling. 256 is not a multiple of 57, so a plain `byte % 57` would
  // make the first 28 characters of the alphabet 25% likelier than the other 29.
  const limit = 256 - (256 % PW_ALPHABET.length);
  let out = '';
  while (out.length < n) {
    for (const b of randomBytes(n * 2)) {
      if (b >= limit) continue;
      out += PW_ALPHABET[b % PW_ALPHABET.length];
      if (out.length === n) break;
    }
  }
  return out;
}

/**
 * A migrated mailbox's initial password: ~105 bits from the system CSPRNG.
 *
 * This was `Migrated_${Math.random().toString(36).slice(2, 10)}!`, which was unsafe
 * in two ways. `Math.random()` is a plain PRNG whose internal state can be recovered
 * from a few outputs, so any user who saw their own password — every migrated user
 * gets one — could derive the passwords of everyone else migrated in the same run.
 * And 8 base36 characters in a known wrapper is a ~41-bit search space, brute
 * forceable offline. Nothing forces a change at first login, so this value is the
 * real, lasting password on the customer's new mailbox.
 *
 * The fixed affixes satisfy complexity rules only; all secrecy is in the middle.
 */
export function generateMailboxPassword(): string {
  return `Am${randomChars(18)}9!`;
}

/**
 * The account id, plus the generated password when this call CREATED the account.
 *
 * A migrated user cannot sign in unless somebody knows their password, and this is
 * the only moment it exists. It used to be written to a log file and forgotten,
 * which left the admin resetting every mailbox by hand — unworkable for an
 * organisation of forty. Callers persist it (encrypted) so it can be handed over.
 */
export interface EnsuredAccount {
  id: string;
  /** Present only for a newly created account; absent when one already existed. */
  tempPassword?: string;
}

export async function ensureAccountExists(email: string, displayName: string): Promise<EnsuredAccount> {
  // Check if already exists
  const existing = await findAccountByEmail(email);
  if (existing) return { id: existing };

  // Determine domain
  const domain = email.split('@')[1];
  if (!domain) throw new Error(`Invalid email: ${email}`);
  const domainId = await getDomainId(domain);
  const name = email.split('@')[0];
  const tempPassword = generateMailboxPassword();

  // Create via x:Account/set
  const responses = await jmap([
    ['x:Account/set', {
      create: {
        new: {
          '@type': 'User',
          name,
          domainId,
          // Flux has no separate displayName field — `description` IS the profile
          // name the webui renders, so never hardcode a label like "Migrated account".
          description: displayName || name,
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
          if (retry) return { id: retry };
        }
        throw new Error(`Failed to create account ${email}: ${err.description ?? JSON.stringify(err)}`);
      }
      const id = result.created?.new?.id;
      if (id) {
        accountIdCache.set(normalizeEmail(email), id);
        // A brand-new account cannot have stale mailboxes cached against it.
        mailboxCache.delete(id);
        console.log(`[account-manager] Created account ${email} (id=${id})`);
        await ensureArchiveMailbox(id);
        return { id, tempPassword };
      }
    }
  }
  throw new Error(`Unexpected response creating account ${email}`);
}

// ── Mailboxes ─────────────────────────────────────────────────────────────────

/**
 * Flux provisions a new account with Inbox, Drafts, Sent Items, Junk Mail and
 * Deleted Items — but no Archive, even though Archive is a standard JMAP role and
 * every mail client offers an archive action.
 *
 * Without this, a migrated user whose source had an Archive folder ended up with
 * one while a native signup did not, so the two never looked alike. Creating it up
 * front means both start from the same six folders.
 *
 * Best-effort: a failure here must not fail account creation.
 */
export async function ensureArchiveMailbox(accountId: string): Promise<void> {
  try {
    const existing = await getMailboxes(accountId);
    if (existing.some(m => m.role === 'archive' || m.name === 'Archive')) return;

    const responses = await jmap([
      ['Mailbox/set', { accountId, create: { archive: { name: 'Archive', role: 'archive' } } }, 'a'],
    ]);
    for (const [method, result] of responses as Array<[string, {
      created?: Record<string, { id: string }>;
      notCreated?: Record<string, unknown>;
    }]>) {
      if (method !== 'Mailbox/set') continue;
      if (result.notCreated?.archive) {
        console.warn(`[account-manager] could not create Archive for ${accountId}: ${JSON.stringify(result.notCreated.archive)}`);
        return;
      }
      if (result.created?.archive) {
        // The cached mailbox list for this account is now stale.
        mailboxCache.delete(accountId);
        console.log(`[account-manager] Created Archive mailbox for account ${accountId}`);
      }
    }
  } catch (err) {
    console.warn(`[account-manager] Archive provisioning failed for ${accountId}: ${err instanceof Error ? err.message : err}`);
  }
}

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

  // Create new mailbox. Carry the role through when the source folder maps to one:
  // resolveMailboxId matches on role first, so a role that Flux has no mailbox for
  // yet (Archive, on a fresh account) fell through to creating a plain, role-less
  // folder. It then looked like Archive but behaved like an ordinary folder.
  const createResponses = await jmap([
    ['Mailbox/set', {
      accountId,
      create: { '1': targetRole ? { name: folderName, role: targetRole } : { name: folderName } },
    }, 'b'],
  ]);
  const [, createResult] = (createResponses[0] ?? []) as [string, {
    created?: Record<string, { id: string }>;
    notCreated?: Record<string, { type?: string; existingId?: string; description?: string }>;
  }];
  const newId = createResult?.created?.['1']?.id;
  if (!newId) {
    // alreadyExists: use the existingId returned by the server
    const notCreatedErr = createResult?.notCreated?.['1'];
    if (notCreatedErr?.type === 'alreadyExists' && notCreatedErr.existingId) {
      return notCreatedErr.existingId;
    }
    // Another worker may have created it concurrently — re-read before failing.
    mailboxCache.delete(accountId);
    const fresh = await getMailboxes(accountId);
    const raced = fresh.find(m => m.name === folderName || m.name === folderName.split('/').pop());
    if (raced) return raced.id;
    throw new Error(`Failed to create mailbox ${folderName} for account ${accountId}: ${JSON.stringify(notCreatedErr ?? 'no created id')}`);
  }

  mailboxes.push({ id: newId, name: folderName });
  return newId;
}
