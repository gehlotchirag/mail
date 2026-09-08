export interface ZohoCreds {
  domain: string;
  orgId: string;
  accessToken: string;
  /**
   * Comma-separated list of mail domains to import, when the Zoho organisation
   * spans more than one and the customer only wants some of them.
   *
   * A Zoho org is billed and administered as a single tenant that can hold many
   * unrelated domains, so "connect Zoho" does not mean "import everything Zoho
   * knows about". Empty or absent means every domain in the org, which keeps the
   * single-domain case unchanged.
   */
  importDomains?: string;
  /**
   * Comma-separated list of specific mailbox addresses to import, when the operator
   * picked individual people rather than whole domains. Takes precedence over
   * `importDomains` — naming four users is a narrower, more deliberate instruction
   * than naming their domain, and intersecting the two would silently drop rows
   * that were explicitly ticked.
   */
  importEmails?: string;
  region?: string; // 'com' | 'in' | 'eu' | 'com.au' | 'jp' — defaults to 'com'
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
}

export async function refreshZohoToken(creds: ZohoCreds): Promise<string> {
  if (!creds.refreshToken || !creds.clientId || !creds.clientSecret) {
    return creds.accessToken;
  }
  const region = creds.region ?? 'com';
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
  });
  const res = await fetch(`https://accounts.zoho.${region}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Zoho token refresh failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`Zoho token refresh error: ${data.error ?? 'no access_token returned'}`);
  return data.access_token;
}

export function zohoApiBase(creds: ZohoCreds): string {
  const region = creds.region ?? 'com';
  return `https://mail.zoho.${region}/api`;
}

function headers(creds: ZohoCreds) {
  return {
    Authorization: `Zoho-oauthtoken ${creds.accessToken}`,
    'Content-Type': 'application/json',
  };
}

export interface ZohoAccount {
  email: string;
  accountId: string;
  isPersonal?: boolean; // true when discovered via personal /accounts API (not org)
  displayName?: string; // human name, used as the Flux account's profile name
}

type ZohoRawAccount = {
  accountId?: string;
  mailId?: string;
  emailId?: string;
  incomingUserName?: string;
  mailboxAddress?: string;
  primaryEmailAddress?: string;
  emailAddress?: Array<{ mailId?: string; isPrimary?: boolean }> | string;
  displayName?: string;
  accountDisplayName?: string;
  firstName?: string;
  lastName?: string;
};

/** Best human-readable name Zoho gives us, or undefined to let the caller fall back. */
function extractDisplayName(a: ZohoRawAccount): string | undefined {
  const full = [a.firstName, a.lastName].filter(Boolean).join(' ').trim();
  return a.displayName?.trim() || a.accountDisplayName?.trim() || full || undefined;
}

/** Parsed, lowercased allow-list of domains, or null when everything is wanted. */
export function parseImportDomains(raw?: string): Set<string> | null {
  const list = (raw ?? '')
    .split(',')
    .map(d => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  return list.length ? new Set(list) : null;
}

/** The mail domain an address belongs to, lowercased. */
export function domainOf(email?: string): string | undefined {
  const at = email?.split('@')[1];
  return at ? at.toLowerCase() : undefined;
}

function extractEmail(a: ZohoRawAccount): string | undefined {
  const arr = a.emailAddress;
  return a.mailId
    ?? a.emailId
    ?? (Array.isArray(arr)
      ? (arr.find(e => e.isPrimary)?.mailId ?? arr[0]?.mailId)
      : typeof arr === 'string' ? arr : undefined)
    ?? a.primaryEmailAddress
    ?? a.mailboxAddress
    ?? a.incomingUserName;
}

export async function discoverZohoAccounts(creds: ZohoCreds): Promise<ZohoAccount[]> {
  // Refresh token first so a stale access token doesn't break discovery
  let activeCreds = creds;
  if (creds.refreshToken) {
    try {
      const fresh = await refreshZohoToken(creds);
      activeCreds = { ...creds, accessToken: fresh };
      console.log('[zoho-discover] token refreshed');
    } catch (e) {
      console.warn('[zoho-discover] token refresh failed, using stored token:', e instanceof Error ? e.message : e);
    }
  }

  const base = zohoApiBase(activeCreds);
  const accounts: ZohoAccount[] = [];
  let tryOrg = true;

  // Applied to every discovery path below. Filtering here rather than in the
  // orchestrator means an excluded domain is never even enumerated, so no mailbox
  // is created for it and no message job is ever queued against it.
  const pickedEmails = parseImportDomains(activeCreds.importEmails);
  const wanted = parseImportDomains(activeCreds.importDomains);
  const keep = (email?: string) => {
    const addr = email?.trim().toLowerCase();
    if (pickedEmails) return !!addr && pickedEmails.has(addr);
    if (!wanted) return true;
    const d = domainOf(email);
    return !!d && wanted.has(d);
  };

  // Try organization API first (only if orgId present and org API is likely to work)
  if (activeCreds.orgId && tryOrg) {
    let start = 0;
    const limit = 200;
    let orgFailed = false;
    // Guards against a loop that cannot terminate. "Keep going until a page is
    // shorter than the limit" never ends for an org whose account count is an exact
    // multiple of the page size, or against a server that ignores `start` and
    // re-serves page one — the console hit exactly that with a 200-mailbox org.
    const seenIds = new Set<string>();
    const MAX_PAGES = 50;
    let pageNo = 0;

    while (!orgFailed && pageNo++ < MAX_PAGES) {
      const url = `${base}/organization/${activeCreds.orgId}/accounts?limit=${limit}&start=${start}`;
      const res = await fetch(url, { headers: headers(activeCreds) });
      const rawText = await res.text();
      console.log(`[zoho-discover] org accounts → ${res.status}`, rawText.slice(0, 800));

      if (!res.ok) {
        // 404 URL_RULE_NOT_CONFIGURED = org API not available for this account type → fall through to personal
        if (res.status === 404 && rawText.includes('URL_RULE_NOT_CONFIGURED')) {
          console.log('[zoho-discover] org API not available for this account, using personal API');
          orgFailed = true; break;
        }
        throw new Error(`Zoho API error: ${res.status} ${res.statusText}`);
      }

      const data = JSON.parse(rawText) as { data?: ZohoRawAccount[] };
      const page = data.data ?? [];
      for (const a of page) {
        const email = extractEmail(a);
        const accountId = a.accountId;
        if (!keep(email)) {
          console.log(`[zoho-discover] org entry → email=${email} SKIPPED (domain not selected for import)`);
          continue;
        }
        console.log(`[zoho-discover] org entry → email=${email} accountId=${accountId}`);
        if (email && accountId) accounts.push({ email, accountId, displayName: extractDisplayName(a) });
      }
      // Nothing new on this page means either the end of the list or a server
      // repeating itself; asking again cannot make progress either way.
      let added = 0;
      for (const a of page) {
        const id = String(a.accountId ?? extractEmail(a) ?? '').toLowerCase();
        if (id && seenIds.has(id)) continue;
        if (id) seenIds.add(id);
        added++;
      }
      if (added === 0) break;
      if (page.length < limit) break;
      start += limit;
    }
    if (pageNo >= MAX_PAGES) {
      console.warn(`[zoho-discover] hit the ${MAX_PAGES}-page ceiling — account list may be incomplete`);
    }
  }

  // Fallback: personal accounts API (for personal/single-user Zoho accounts)
  if (accounts.length === 0) {
    console.log('[zoho-discover] falling back to personal /accounts API');
    const res = await fetch(`${base}/accounts`, { headers: headers(activeCreds) });
    const rawText = await res.text();
    console.log('[zoho-discover] personal accounts →', res.status, rawText.slice(0, 800));
    if (res.ok) {
      const data = JSON.parse(rawText) as { data?: ZohoRawAccount[] };
      for (const acct of data.data ?? []) {
        const email = extractEmail(acct);
        const accountId = acct.accountId;
        if (!keep(email)) {
          console.log(`[zoho-discover] personal entry → email=${email} SKIPPED (domain not selected for import)`);
          continue;
        }
        console.log(`[zoho-discover] personal entry → email=${email} accountId=${accountId}`);
        if (email && accountId) accounts.push({ email, accountId, isPersonal: true, displayName: extractDisplayName(acct) });
      }
    }
  }

  return accounts;
}

// Returns the correct API base path for a given account (org vs personal)
function accountBasePath(creds: ZohoCreds, zohoAccountId: string, isPersonal?: boolean): string {
  const base = zohoApiBase(creds);
  return isPersonal
    ? `${base}/accounts/${zohoAccountId}`
    : `${base}/organization/${creds.orgId}/accounts/${zohoAccountId}`;
}

// Kept for orchestrator compatibility (returns email strings)
export async function discoverZohoUsers(creds: ZohoCreds): Promise<string[]> {
  return (await discoverZohoAccounts(creds)).map(a => a.email);
}

// ── Mailbox access via Zoho Organization Admin API ────────────────────────────
// Required OAuth2 scopes: ZohoMail.organization.accounts.READ, ZohoMail.messages.READ

export interface ZohoFolder {
  folderId: string;
  folderName: string;
  path: string;
}

// Returns folders and the effective isPersonal flag (may differ from input if auto-fallback occurred).
// When the org-path endpoint returns 404 URL_RULE_NOT_CONFIGURED, we transparently retry
// with the personal path so callers can propagate the correct flag to subsequent calls.
export async function fetchZohoFolders(
  creds: ZohoCreds,
  zohoAccountId: string,
  isPersonal?: boolean,
): Promise<{ folders: ZohoFolder[]; effectiveIsPersonal: boolean }> {
  const folders: ZohoFolder[] = [];
  let start = 0;
  const limit = 200;
  let usePersonal = isPersonal ?? false;

  while (true) {
    const acctBase = accountBasePath(creds, zohoAccountId, usePersonal);
    // Personal API returns all folders in one call — no pagination params accepted
    const folderUrl = usePersonal
      ? `${acctBase}/folders`
      : `${acctBase}/folders?start=${start}&limit=${limit}`;
    console.log(`[zoho-folders] GET ${folderUrl}`);
    const res = await fetch(folderUrl, { headers: headers(creds) });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[zoho-folders] ${res.status} from ${folderUrl}: ${body.slice(0, 400)}`);
      // Org path not available for personal-type Zoho accounts — auto-fallback to personal path
      if (res.status === 404 && !usePersonal && body.includes('URL_RULE_NOT_CONFIGURED')) {
        console.log('[zoho-folders] org path unavailable, switching to personal path');
        usePersonal = true;
        start = 0; // restart pagination on the new path
        continue;
      }
      throw new Error(`Zoho folders error: ${res.status} ${res.statusText}`);
    }
    const raw = await res.text();
    console.log(`[zoho-folders] response: ${raw.slice(0, 600)}`);
    const data = JSON.parse(raw) as {
      data?: Array<{ folderId: string; folderName: string; path?: string }>;
    };
    const page = data.data ?? [];
    for (const f of page) {
      folders.push({ folderId: f.folderId, folderName: f.folderName, path: f.path ?? f.folderName });
    }
    if (usePersonal || page.length < limit) break;
    start += limit;
  }
  return { folders, effectiveIsPersonal: usePersonal };
}

export interface ZohoMsgSummary {
  messageId: string;
  receivedTime: number; // epoch ms
  isRead: boolean;
  isFlagged: boolean;
}

export async function fetchZohoMessageIds(
  creds: ZohoCreds,
  zohoAccountId: string,
  folderId: string,
  start: number,
  isPersonal?: boolean,
): Promise<{ messages: ZohoMsgSummary[]; hasMore: boolean }> {
  const limit = 200;
  const acctBase = accountBasePath(creds, zohoAccountId, isPersonal);

  let url: string;
  if (isPersonal) {
    // Personal API — /folders/{id}/messages returns INVALID_METHOD.
    // Use the search API with received:>0 (wildcard for all messages) + folderId filter.
    url = `${acctBase}/messages/search?searchKey=received:>0&folderId=${folderId}&limit=${limit}&start=${start}`;
  } else {
    url = `${acctBase}/folders/${folderId}/messages?start=${start}&limit=${limit}&sortBy=Date&sortOrder=asc`;
  }

  console.log(`[zoho-messages] GET ${url}`);
  const res = await fetch(url, { headers: headers(creds) });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[zoho-messages] ${res.status} from ${url}: ${body.slice(0, 400)}`);
    throw new Error(`Zoho messages list error: ${res.status} ${res.statusText}`);
  }

  if (isPersonal) {
    // Search API response uses different field names than the org folder listing API:
    // - status: "0" = unread, "1" = read (instead of isRead: boolean)
    // - flagid: "flag_not_set" | "flag_set" (instead of isFlagged: boolean)
    // - receivedTime may be a numeric string
    const data = await res.json() as {
      data?: Array<{ messageId: string; receivedTime?: string | number; sentDateInGMT?: string | number; status?: string; flagid?: string }>;
    };
    const msgs = (data.data ?? []).map(m => ({
      messageId: m.messageId,
      receivedTime: Number(m.receivedTime ?? m.sentDateInGMT ?? 0),
      isRead: m.status === '1',
      isFlagged: !!m.flagid && m.flagid !== 'flag_not_set',
    }));
    return { messages: msgs, hasMore: msgs.length === limit };
  }

  const data = await res.json() as {
    data?: Array<{ messageId: string; receivedTime: number; isRead: boolean; isFlagged?: boolean }>;
  };
  const msgs = (data.data ?? []).map(m => ({
    messageId: m.messageId,
    receivedTime: m.receivedTime,
    isRead: m.isRead,
    isFlagged: m.isFlagged ?? false,
  }));
  return { messages: msgs, hasMore: msgs.length === limit };
}

export async function fetchZohoRawMessage(
  creds: ZohoCreds,
  zohoAccountId: string,
  messageId: string,
  isPersonal?: boolean,
): Promise<{ raw: Buffer; isRead: boolean; isFlagged: boolean }> {
  const acctBase = accountBasePath(creds, zohoAccountId, isPersonal);
  // See message-import.processor.ts: only `originalmessage` returns raw RFC822.
  const res = await fetch(
    `${acctBase}/messages/${messageId}/originalmessage`,
    { headers: headers(creds) },
  );
  if (!res.ok) throw new Error(`Zoho message content error: ${res.status} ${res.statusText}`);
  const data = await res.json() as {
    data?: { content?: string; isRead?: boolean; isFlagged?: boolean };
  };
  const rawStr = data.data?.content;
  if (!rawStr) throw new Error(`No raw content returned for Zoho message ${messageId}`);
  return {
    // Plain RFC822 text, not base64.
    raw: Buffer.from(rawStr, 'utf8'),
    isRead: data.data?.isRead ?? false,
    isFlagged: data.data?.isFlagged ?? false,
  };
}
