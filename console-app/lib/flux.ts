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
  /** Bytes currently stored by this mailbox. */
  usedDiskQuota?: number;
  /** Per-account limits; `maxDiskQuota` is the storage cap in bytes when set. */
  quotas?: { maxDiskQuota?: number };
}

/**
 * A JMAP SetError exactly as Stalwart's registry serialises it
 * (crates/jmap-proto/src/error/set.rs). `description`, `properties` and
 * `validationErrors` are all `skip_serializing_if` — only `type` is guaranteed
 * to be present, so never pattern-match on the prose.
 */
export interface JmapSetError {
  type?: string;
  description?: string;
  /** JSON-pointer paths of the properties the server objected to. */
  properties?: string[];
  validationErrors?: Array<{ type?: string; property?: string; value?: string; required?: number }>;
  existingId?: string;
  objectId?: string;
}

/** Method-level errors come back as ['error', { type, description }]. */
type JmapMethodError = { type?: string; description?: string };

/**
 * SetError/method-error types that Stalwart emits when it does not understand a
 * property or a JSON-pointer path:
 *  - `invalidPatch` — every PatchError from the registry maps to this
 *    (`impl From<PatchError> for SetError`), e.g. "Invalid key for object",
 *    "Invalid key for object property", "Invalid JSON Pointer path".
 *  - `invalidProperties` — SetError::invalid_properties(), often with neither a
 *    description nor a `properties` list.
 *  - `invalidArguments` — the method-level equivalent when the whole call is
 *    rejected before it reaches the object.
 */
const PROPERTY_REJECTION_TYPES = new Set(['invalidPatch', 'invalidProperties', 'invalidArguments']);

/** Turns a SetError into something worth showing a human, without inventing prose. */
export function describeSetError(err: JmapSetError | undefined, fallback: string): string {
  if (!err) return fallback;
  const bits: string[] = [];
  if (err.description) bits.push(err.description);
  else if (err.validationErrors?.length) {
    bits.push(err.validationErrors
      .map(v => [v.property, v.type].filter(Boolean).join(' ') || 'invalid')
      .join(', '));
  }
  if (err.properties?.length) bits.push(`(${err.properties.join(', ')})`);
  const detail = bits.join(' ').trim();
  if (err.type && detail) return `${err.type}: ${detail}`;
  return detail || err.type || fallback;
}

/** True when `path` is `property` itself or a JSON pointer beneath it. */
function pathTargets(path: string | undefined, property: string): boolean {
  if (!path) return false;
  const clean = path.replace(/^\//, '');
  return clean === property || clean.startsWith(`${property}/`);
}

/**
 * Decides whether a SetError means "the server does not accept this property",
 * as opposed to a real business failure (duplicate name, bad domain, forbidden).
 *
 * Stalwart names the offending property whenever it can — `properties` for a
 * patch/property error, `validationErrors[].property` for a validation failure.
 * When it names anything at all we only treat the rejection as ours if our
 * property is among them. When it names nothing (SetError::invalid_properties()
 * carries no description and no property list) we fall back to the error type.
 */
export function isPropertyRejection(
  err: JmapSetError | JmapMethodError | undefined, property: string
): boolean {
  if (!err) return false;
  const set = err as JmapSetError;
  const named = [
    ...(set.properties ?? []),
    ...(set.validationErrors ?? []).map(v => v.property),
  ].filter((p): p is string => !!p);

  if (named.length) return named.some(p => pathTargets(p, property));
  return PROPERTY_REJECTION_TYPES.has(err.type ?? '');
}

export async function addDomain(domain: string): Promise<{ id: string } | { error: string }> {
  const responses = await jmap([
    ['x:Domain/set', { create: { new: { name: domain } } }, 'c'],
  ]);
  for (const [method, result] of responses as Array<[string, {
    created?: Record<string, { id: string }>;
    notCreated?: Record<string, JmapSetError>;
  }]>) {
    if (method === 'x:Domain/set') {
      const failure = result.notCreated?.new;
      if (failure) {
        // A duplicate comes back as `primaryKeyViolation` / `alreadyExists`;
        // the description is optional, so the type is what we key off.
        const duplicate = failure.type === 'primaryKeyViolation'
          || failure.type === 'alreadyExists'
          || /already|exist/i.test(failure.description ?? '');
        if (duplicate) {
          const existing = await getDomainId(domain);
          if (existing) return { id: existing };
        }
        return { error: describeSetError(failure, 'Failed to add domain') };
      }
      const id = result.created?.new?.id;
      if (id) return { id };
    }
  }
  return { error: 'Unexpected response' };
}

/**
 * Flux provisions a NEW domain with both DKIM algorithms enabled, and signs once
 * per *active key* — producing two `DKIM-Signature` headers. That is legal under
 * RFC 6376 but Amazon SES rejects it outright:
 *
 *   554 Transaction failed: Duplicate header 'DKIM-Signature'
 *
 * ...which bounces every outbound message for that domain. Since we relay through
 * SES, every domain must end up with exactly one signature.
 *
 * Turning the algorithm flag off only stops future rotation — the key generated at
 * creation stays `stage: active` and keeps signing — so we must ALSO destroy the
 * Ed25519 keys. RSA/SHA-256 is kept: it is universally supported.
 *
 * Safe to call repeatedly; it is a no-op once a domain is already single-signature.
 */
export async function enforceSingleDkimSignature(
  fluxDomainId: string,
): Promise<{ disabled: boolean; destroyed: string[]; error?: string }> {
  const destroyed: string[] = [];
  let disabled = false;
  try {
    // 1. stop regeneration on the next rotation
    const domainRes = await jmap([
      ['x:Domain/get', { ids: [fluxDomainId], properties: ['id', 'dkimManagement'] }, 'g'],
    ]);
    let dkim: { algorithms?: Record<string, boolean> } | undefined;
    for (const [method, result] of domainRes as Array<[string, { list?: Array<{ dkimManagement?: typeof dkim }> }]>) {
      if (method === 'x:Domain/get') dkim = result.list?.[0]?.dkimManagement;
    }
    if (dkim?.algorithms?.Dkim1Ed25519Sha256) {
      await jmap([
        ['x:Domain/set', {
          update: {
            [fluxDomainId]: {
              dkimManagement: { ...dkim, algorithms: { ...dkim.algorithms, Dkim1Ed25519Sha256: false } },
            },
          },
        }, 's'],
      ]);
      disabled = true;
    }

    // 2. destroy the Ed25519 key(s) already generated for this domain
    const keyRes = await jmap([
      ['x:DkimSignature/query', {}, 'q'],
      ['x:DkimSignature/get', {
        '#ids': { resultOf: 'q', name: 'x:DkimSignature/query', path: '/ids' },
        properties: ['id', 'domainId', '@type'],
      }, 'g'],
    ]);
    const doomed: string[] = [];
    for (const [method, result] of keyRes as Array<[string, { list?: Array<{ id: string; domainId?: string; '@type'?: string }> }]>) {
      if (method !== 'x:DkimSignature/get') continue;
      for (const k of result.list ?? []) {
        if (k.domainId === fluxDomainId && k['@type'] === 'Dkim1Ed25519Sha256') doomed.push(k.id);
      }
    }
    if (doomed.length) {
      const delRes = await jmap([['x:DkimSignature/set', { destroy: doomed }, 'x']]);
      for (const [method, result] of delRes as Array<[string, { destroyed?: string[] }]>) {
        if (method === 'x:DkimSignature/set') destroyed.push(...(result.destroyed ?? []));
      }
    }
    return { disabled, destroyed };
  } catch (err) {
    // Never block domain creation on this — report it so the caller can warn.
    return { disabled, destroyed, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function removeDomain(fluxDomainId: string): Promise<{ error?: string }> {
  // Flux auto-generates a DKIM signing key for every new domain, and that key holds
  // a reference back to it — so destroying the domain first fails with
  // `objectIsLinked` even when the domain has no mailboxes at all. Clear the keys we
  // provisioned, then remove the domain.
  //
  // Deliberately narrow: only DKIM keys, and only ones belonging to THIS domain. If
  // anything else still references it (accounts, lists), the destroy below is left to
  // fail and report why, rather than this quietly bulldozing linked objects.
  try {
    const keyRes = await jmap([
      ['x:DkimSignature/query', {}, 'q'],
      ['x:DkimSignature/get', {
        '#ids': { resultOf: 'q', name: 'x:DkimSignature/query', path: '/ids' },
        properties: ['id', 'domainId'],
      }, 'g'],
    ]);
    const doomed: string[] = [];
    for (const [method, result] of keyRes as Array<[string, { list?: Array<{ id: string; domainId?: string }> }]>) {
      if (method !== 'x:DkimSignature/get') continue;
      for (const k of result.list ?? []) if (k.domainId === fluxDomainId) doomed.push(k.id);
    }
    if (doomed.length) {
      await jmap([['x:DkimSignature/set', { destroy: doomed }, 'k']]);
      console.log(`[flux] removed ${doomed.length} DKIM key(s) linked to domain ${fluxDomainId}`);
    }
  } catch (err) {
    // Not fatal on its own — let the domain destroy report the real blocker.
    console.warn(`[flux] could not clear DKIM keys for ${fluxDomainId}: ${err instanceof Error ? err.message : err}`);
  }

  const responses = await jmap([
    ['x:Domain/set', { destroy: [fluxDomainId] }, 'd'],
  ]);
  for (const [method, result] of responses as Array<[string, {
    notDestroyed?: Record<string, JmapSetError>;
  }]>) {
    if (method === 'x:Domain/set' && result.notDestroyed?.[fluxDomainId]) {
      return { error: describeSetError(result.notDestroyed[fluxDomainId], 'Delete failed') };
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

// `usedDiskQuota` is what the account is actually consuming and `quotas` holds its
// limit (`maxDiskQuota`) when one is set. Both come back from the same
// x:Account/get we already make, so showing storage per mailbox costs no extra
// round-trip — it was simply never requested.
const ACCOUNT_PROPERTIES = ['id', 'name', 'emailAddress', 'description', 'domainId', 'usedDiskQuota', 'quotas'];

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
 * Flux/Stalwart stores per-account limits in the `quotas` map of the account
 * object (`UserAccount.quotas: VecMap<StorageQuota, u64>`); `maxDiskQuota` is
 * the total mailbox+blob size in bytes (0 = unlimited). It can be supplied on
 * create or patched later via the `quotas/maxDiskQuota` JSON pointer.
 */
const QUOTA_PROPERTY = 'quotas';
const DISK_QUOTA_PROPERTY = 'quotas/maxDiskQuota';

/** How many account updates to put in a single x:Account/set call. */
const SET_BATCH_SIZE = 100;

type CreateFailure = { error: string; jmapError?: JmapSetError };

async function createAccount(
  name: string, domainId: string, password: string, description: string, quotaBytes?: number
): Promise<{ id: string } | CreateFailure> {
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
    notCreated?: Record<string, JmapSetError>;
    type?: string;
    description?: string;
  }]>) {
    // A method-level failure (e.g. an unknown argument) comes back as 'error'.
    if (method === 'error') {
      const methodError = { type: result.type, description: result.description };
      return {
        error: describeSetError(methodError, 'Request failed'),
        jmapError: methodError,
      };
    }
    if (method === 'x:Account/set') {
      const failure = result.notCreated?.new;
      if (failure) {
        return { error: describeSetError(failure, 'Creation failed'), jmapError: failure };
      }
      const id = result.created?.new?.id;
      if (id) return { id };
    }
  }
  return { error: 'Unexpected response' };
}

/**
 * Creates a mail account, applying the plan's per-user disk quota.
 *
 * If the server rejects the create *because of* the quota property (a build
 * without `quotas` on the account object), the account is created without it
 * and the quota is applied as a follow-up patch. The decision is made from the
 * SetError `type` and its `properties`/`validationErrors` lists — never from the
 * description, which Stalwart omits entirely for `invalidProperties`.
 * `quotaApplied` reports whether the quota actually made it onto the account.
 */
export async function createUser(
  name: string, domainId: string, password: string, description?: string, quotaBytes?: number
): Promise<{ id: string; quotaApplied: boolean } | { error: string }> {
  const desc = description ?? '';
  const wantsQuota = !!quotaBytes && quotaBytes > 0;

  const result = await createAccount(name, domainId, password, desc, quotaBytes);
  if (!('error' in result)) {
    await ensureArchiveMailbox(result.id);
    return { id: result.id, quotaApplied: wantsQuota };
  }

  // Only retry if the server rejected the quota property itself — anything else
  // (duplicate account, bad domain, forbidden) is a real error.
  if (!wantsQuota || !isPropertyRejection(result.jmapError, QUOTA_PROPERTY)) {
    return { error: result.error };
  }

  console.warn(`[flux] Account create rejected the quota property (${result.error}); retrying without it`);
  const retry = await createAccount(name, domainId, password, desc);
  if ('error' in retry) return { error: retry.error };

  await ensureArchiveMailbox(retry.id);

  const quota = await setAccountQuota(retry.id, quotaBytes!);
  if (quota.error) {
    console.error(`[flux] Could not set disk quota on account ${retry.id}: ${quota.error}`);
    return { id: retry.id, quotaApplied: false };
  }
  return { id: retry.id, quotaApplied: true };
}

/**
 * Flux creates a new account with Inbox, Drafts, Sent Items, Junk Mail and Deleted
 * Items — but no Archive, despite it being a standard JMAP role that every mail
 * client offers an archive action for. Migrated accounts inherited an Archive from
 * their source while native signups did not, so the two never looked alike.
 *
 * Best-effort: never fail account creation over a mailbox.
 */
export async function ensureArchiveMailbox(accountId: string): Promise<void> {
  try {
    const existing = await jmap([
      ['Mailbox/get', { accountId, ids: null, properties: ['id', 'name', 'role'] }, 'g'],
    ]);
    for (const [method, result] of existing as Array<[string, { list?: Array<{ name?: string; role?: string }> }]>) {
      if (method !== 'Mailbox/get') continue;
      if ((result.list ?? []).some(m => m.role === 'archive' || m.name === 'Archive')) return;
    }

    const created = await jmap([
      ['Mailbox/set', { accountId, create: { archive: { name: 'Archive', role: 'archive' } } }, 'a'],
    ]);
    for (const [method, result] of created as Array<[string, { notCreated?: Record<string, unknown> }]>) {
      if (method === 'Mailbox/set' && result.notCreated?.archive) {
        console.warn(`[flux] could not create Archive for ${accountId}: ${JSON.stringify(result.notCreated.archive)}`);
      }
    }
  } catch (err) {
    console.warn(`[flux] Archive provisioning failed for ${accountId}: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Sets the total disk quota (bytes, 0 = unlimited) on one or more accounts in a
 * single x:Account/set call, chunked so a large organisation never exceeds the
 * server's `setMaxObjects`. Returns a per-account error map: an id absent from
 * the map was updated successfully.
 *
 * Both failure shapes are handled: a method-level ['error', ...] response, which
 * fails every id in that chunk, and per-id `notUpdated` SetErrors. An id that
 * comes back in neither `updated` nor `notUpdated` is reported as an error
 * rather than silently assumed to have worked.
 */
export async function setAccountQuotas(
  quotaByAccountId: Record<string, number>
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  const ids = Object.keys(quotaByAccountId);

  for (let i = 0; i < ids.length; i += SET_BATCH_SIZE) {
    const chunk = ids.slice(i, i + SET_BATCH_SIZE);
    const update: Record<string, Record<string, number>> = {};
    for (const id of chunk) update[id] = { [DISK_QUOTA_PROPERTY]: quotaByAccountId[id] };

    let responses: unknown[][];
    try {
      responses = await jmap([['x:Account/set', { update }, 'u']]);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Quota update failed';
      for (const id of chunk) errors[id] = message;
      continue;
    }

    let handled = false;
    for (const [method, result] of responses as Array<[string, {
      updated?: Record<string, unknown>;
      notUpdated?: Record<string, JmapSetError>;
      type?: string;
      description?: string;
    }]>) {
      // Method-level rejection — the whole chunk failed, nothing was updated.
      if (method === 'error') {
        const message = describeSetError(
          { type: result.type, description: result.description }, 'Quota update failed'
        );
        for (const id of chunk) errors[id] = message;
        handled = true;
        break;
      }
      if (method === 'x:Account/set') {
        handled = true;
        for (const id of chunk) {
          const failure = result.notUpdated?.[id];
          if (failure) {
            errors[id] = describeSetError(failure, 'Quota update failed');
          } else if (!result.updated || !Object.prototype.hasOwnProperty.call(result.updated, id)) {
            // Neither updated nor notUpdated: the server ignored the id. A
            // missing or null `updated` map is exactly that case — gating this
            // on `result.updated` being truthy reported every quota as applied.
            errors[id] = 'Quota update was not acknowledged by the server';
          }
        }
      }
    }
    if (!handled) for (const id of chunk) errors[id] = 'Unexpected response';
  }

  return errors;
}

/** Sets one account's total disk quota in bytes (0 = unlimited). */
export async function setAccountQuota(id: string, quotaBytes: number): Promise<{ error?: string }> {
  const errors = await setAccountQuotas({ [id]: quotaBytes });
  return errors[id] ? { error: errors[id] } : {};
}

/**
 * Best-effort read of the current `quotas.maxDiskQuota` for the given accounts.
 * Returns an empty map if the build does not expose the property, so callers
 * must treat "no entry" as "unknown", never as "no quota".
 */
export async function getAccountDiskQuotas(ids: string[]): Promise<Map<string, number>> {
  const quotas = new Map<string, number>();
  if (!ids.length) return quotas;

  for (let i = 0; i < ids.length; i += SET_BATCH_SIZE) {
    const chunk = ids.slice(i, i + SET_BATCH_SIZE);
    try {
      const responses = await jmap([
        ['x:Account/get', { ids: chunk, properties: ['id', QUOTA_PROPERTY] }, 'g'],
      ]);
      for (const [method, result] of responses as Array<[string, {
        list?: Array<{ id: string; quotas?: Record<string, number> | null }>;
      }]>) {
        if (method !== 'x:Account/get' || !result.list) continue;
        for (const account of result.list) {
          const value = account.quotas?.maxDiskQuota;
          if (typeof value === 'number') quotas.set(account.id, value);
        }
      }
    } catch {
      return new Map();
    }
  }
  return quotas;
}

export async function deleteUser(id: string): Promise<{ error?: string }> {
  const responses = await jmap([['x:Account/set', { destroy: [id] }, 'd']]);
  for (const [method, result] of responses as Array<[string, {
    notDestroyed?: Record<string, JmapSetError>;
  }]>) {
    if (method === 'x:Account/set' && result.notDestroyed?.[id]) {
      return { error: describeSetError(result.notDestroyed[id], 'Delete failed') };
    }
  }
  return {};
}

export async function resetPassword(id: string, password: string): Promise<{ error?: string }> {
  const responses = await jmap([
    ['x:Account/set', { update: { [id]: { 'credentials/0/secret': password } } }, 'u'],
  ]);
  for (const [method, result] of responses as Array<[string, {
    notUpdated?: Record<string, JmapSetError>;
  }]>) {
    if (method === 'x:Account/set' && result.notUpdated?.[id]) {
      return { error: describeSetError(result.notUpdated[id], 'Reset failed') };
    }
  }
  return {};
}

/* ------------------------------------------------------------------------- *
 * Aliases and distribution lists
 *
 * Both are native to this Flux build, verified against the vendored Stalwart
 * source in mail/:
 *  - `UserAccount.aliases` / `GroupAccount.aliases` / `MailingList.aliases` are
 *    `List<EmailAlias>` (registry/src/schema/structs.rs), and every alias is
 *    added to the account's deliverable address set alongside the primary
 *    address (common/src/cache/principals.rs).
 *  - `List<T>` is `VecMap<u32, T>` on the wire — a JSON *object* keyed by
 *    stringified indices, NOT an array. Sending an array fails deserialisation.
 *  - An `EmailAlias` is `{ enabled, name, domainId, description }` where `name`
 *    is the local part only, so an alias may live on a different domain from
 *    the account's primary one.
 *  - A distribution list is a separate registry object, `x:MailingList`, whose
 *    `recipients` is a `Map<String>` — on the wire a boolean set,
 *    `{ "a@example.com": true }`. Mail to its address expands to the recipients
 *    (common/src/network/mta.rs, `RcptResolution::Expand`).
 * ------------------------------------------------------------------------- */

export interface FluxEmailAlias {
  enabled: boolean;
  /** Local part only — the domain comes from `domainId`. */
  name: string;
  domainId: string;
  description?: string | null;
}

const ALIAS_PROPERTIES = ['id', 'name', 'emailAddress', 'domainId', 'aliases'];

export interface FluxAccountWithAliases extends FluxUser {
  aliases: FluxEmailAlias[];
}

/** `List<EmailAlias>` arrives as `{ "0": {...}, "1": {...} }`. */
function decodeAliasList(raw: unknown): FluxEmailAlias[] {
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw as Record<string, FluxEmailAlias>)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, alias]) => ({
      enabled: alias.enabled !== false,
      name: alias.name,
      domainId: alias.domainId,
      description: alias.description ?? null,
    }))
    .filter(a => a.name && a.domainId);
}

function encodeAliasList(aliases: FluxEmailAlias[]): Record<string, FluxEmailAlias> {
  const out: Record<string, FluxEmailAlias> = {};
  aliases.forEach((alias, i) => {
    out[String(i)] = {
      enabled: alias.enabled !== false,
      name: alias.name,
      domainId: alias.domainId,
      ...(alias.description ? { description: alias.description } : {}),
    };
  });
  return out;
}

/** Accounts with their aliases. Fetched in one round-trip per chunk of ids. */
export async function listAccountsWithAliases(ids: string[]): Promise<FluxAccountWithAliases[]> {
  const accounts: FluxAccountWithAliases[] = [];
  for (let i = 0; i < ids.length; i += SET_BATCH_SIZE) {
    const chunk = ids.slice(i, i + SET_BATCH_SIZE);
    const responses = await jmap([
      ['x:Account/get', { ids: chunk, properties: ALIAS_PROPERTIES }, 'g'],
    ]);
    for (const [method, result] of responses as Array<[string, {
      list?: Array<FluxUser & { aliases?: unknown }>;
    }]>) {
      if (method !== 'x:Account/get' || !result.list) continue;
      for (const account of result.list) {
        accounts.push({ ...account, aliases: decodeAliasList(account.aliases) });
      }
    }
  }
  return accounts;
}

/**
 * Replaces an account's alias list wholesale.
 *
 * The whole list is sent rather than an indexed patch (`aliases/2`) because the
 * server re-sorts and compacts indices, so an index read a moment ago is not a
 * stable handle. Callers must therefore read-modify-write; concurrent edits to
 * the same account will last-write-win.
 */
export async function setAccountAliases(
  id: string, aliases: FluxEmailAlias[]
): Promise<{ error?: string }> {
  const responses = await jmap([
    ['x:Account/set', { update: { [id]: { aliases: encodeAliasList(aliases) } } }, 'u'],
  ]);
  for (const [method, result] of responses as Array<[string, {
    updated?: Record<string, unknown>;
    notUpdated?: Record<string, JmapSetError>;
    type?: string;
    description?: string;
  }]>) {
    if (method === 'error') {
      return {
        error: describeSetError({ type: result.type, description: result.description }, 'Alias update failed'),
      };
    }
    if (method === 'x:Account/set') {
      const failure = result.notUpdated?.[id];
      if (failure) return { error: describeSetError(failure, 'Alias update failed') };
      return {};
    }
  }
  return { error: 'Unexpected response' };
}

export interface FluxMailingList {
  id: string;
  name: string;
  emailAddress?: string;
  domainId: string;
  description?: string | null;
  recipients: string[];
}

const MAILING_LIST_PROPERTIES = ['id', 'name', 'emailAddress', 'domainId', 'description', 'recipients'];

/** `Map<String>` arrives as a boolean set: `{ "a@example.com": true }`. */
function decodeRecipients(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw as Record<string, boolean>)
    .filter(([, on]) => on !== false)
    .map(([address]) => address);
}

function encodeRecipients(recipients: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const address of recipients) out[address] = true;
  return out;
}

export async function listMailingLists(): Promise<FluxMailingList[]> {
  const responses = await jmap([
    ['x:MailingList/query', {}, 'q'],
    ['x:MailingList/get', {
      '#ids': { resultOf: 'q', name: 'x:MailingList/query', path: '/ids' },
      properties: MAILING_LIST_PROPERTIES,
    }, 'g'],
  ]);
  for (const [method, result] of responses as Array<[string, {
    list?: Array<Omit<FluxMailingList, 'recipients'> & { recipients?: unknown }>;
  }]>) {
    if (method === 'x:MailingList/get' && result.list) {
      return result.list.map(l => ({ ...l, recipients: decodeRecipients(l.recipients) }));
    }
  }
  return [];
}

export async function createMailingList(
  name: string, domainId: string, recipients: string[], description?: string
): Promise<{ id: string } | { error: string }> {
  const responses = await jmap([
    ['x:MailingList/set', {
      create: {
        new: {
          name, domainId,
          ...(description ? { description } : {}),
          recipients: encodeRecipients(recipients),
        },
      },
    }, 'c'],
  ]);
  for (const [method, result] of responses as Array<[string, {
    created?: Record<string, { id: string }>;
    notCreated?: Record<string, JmapSetError>;
    type?: string;
    description?: string;
  }]>) {
    if (method === 'error') {
      return {
        error: describeSetError({ type: result.type, description: result.description }, 'Request failed'),
      };
    }
    if (method === 'x:MailingList/set') {
      const failure = result.notCreated?.new;
      if (failure) return { error: describeSetError(failure, 'Could not create the list') };
      const id = result.created?.new?.id;
      if (id) return { id };
    }
  }
  return { error: 'Unexpected response' };
}

export async function updateMailingList(
  id: string, patch: { recipients?: string[]; description?: string | null }
): Promise<{ error?: string }> {
  const update: Record<string, unknown> = {};
  if (patch.recipients) update.recipients = encodeRecipients(patch.recipients);
  if (patch.description !== undefined) update.description = patch.description;
  if (!Object.keys(update).length) return {};

  const responses = await jmap([['x:MailingList/set', { update: { [id]: update } }, 'u']]);
  for (const [method, result] of responses as Array<[string, {
    notUpdated?: Record<string, JmapSetError>;
    type?: string;
    description?: string;
  }]>) {
    if (method === 'error') {
      return {
        error: describeSetError({ type: result.type, description: result.description }, 'Update failed'),
      };
    }
    if (method === 'x:MailingList/set') {
      const failure = result.notUpdated?.[id];
      if (failure) return { error: describeSetError(failure, 'Update failed') };
      return {};
    }
  }
  return { error: 'Unexpected response' };
}

export async function deleteMailingList(id: string): Promise<{ error?: string }> {
  const responses = await jmap([['x:MailingList/set', { destroy: [id] }, 'd']]);
  for (const [method, result] of responses as Array<[string, {
    notDestroyed?: Record<string, JmapSetError>;
  }]>) {
    if (method === 'x:MailingList/set' && result.notDestroyed?.[id]) {
      return { error: describeSetError(result.notDestroyed[id], 'Delete failed') };
    }
  }
  return {};
}
