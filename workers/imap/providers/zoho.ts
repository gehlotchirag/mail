export interface ZohoCreds {
  domain: string;
  orgId: string;
  accessToken: string;
  region?: string; // 'com' | 'in' | 'eu' | 'com.au' | 'jp' — defaults to 'com'
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
}

export async function discoverZohoAccounts(creds: ZohoCreds): Promise<ZohoAccount[]> {
  const base = zohoApiBase(creds);
  const accounts: ZohoAccount[] = [];
  let start = 0;
  const limit = 200;

  while (true) {
    const res = await fetch(
      `${base}/organization/${creds.orgId}/accounts?limit=${limit}&start=${start}`,
      { headers: headers(creds) },
    );
    if (!res.ok) throw new Error(`Zoho API error: ${res.status} ${res.statusText}`);
    const data = await res.json() as { data?: Array<{ mailId: string; accountId: string }> };
    const page = data.data ?? [];
    for (const a of page) {
      if (a.mailId) accounts.push({ email: a.mailId, accountId: a.accountId });
    }
    if (page.length < limit) break;
    start += limit;
  }
  return accounts;
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

export async function fetchZohoFolders(
  creds: ZohoCreds,
  zohoAccountId: string,
): Promise<ZohoFolder[]> {
  const base = zohoApiBase(creds);
  const res = await fetch(
    `${base}/organization/${creds.orgId}/accounts/${zohoAccountId}/folders`,
    { headers: headers(creds) },
  );
  if (!res.ok) throw new Error(`Zoho folders error: ${res.status} ${res.statusText}`);
  const data = await res.json() as {
    data?: Array<{ folderId: string; folderName: string; path?: string }>;
  };
  return (data.data ?? []).map(f => ({
    folderId: f.folderId,
    folderName: f.folderName,
    path: f.path ?? f.folderName,
  }));
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
): Promise<{ messages: ZohoMsgSummary[]; hasMore: boolean }> {
  const limit = 200;
  const base = zohoApiBase(creds);
  const url =
    `${base}/organization/${creds.orgId}/accounts/${zohoAccountId}` +
    `/folders/${folderId}/messages?start=${start}&limit=${limit}&sortBy=Date&sortOrder=asc`;
  const res = await fetch(url, { headers: headers(creds) });
  if (!res.ok) throw new Error(`Zoho messages list error: ${res.status} ${res.statusText}`);
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
): Promise<{ raw: Buffer; isRead: boolean; isFlagged: boolean }> {
  const base = zohoApiBase(creds);
  const res = await fetch(
    `${base}/organization/${creds.orgId}/accounts/${zohoAccountId}/messages/content/${messageId}?include=raw`,
    { headers: headers(creds) },
  );
  if (!res.ok) throw new Error(`Zoho message content error: ${res.status} ${res.statusText}`);
  const data = await res.json() as {
    data?: { content?: string; isRead?: boolean; isFlagged?: boolean };
  };
  const rawStr = data.data?.content;
  if (!rawStr) throw new Error(`No raw content returned for Zoho message ${messageId}`);
  return {
    raw: Buffer.from(rawStr, 'base64'),
    isRead: data.data?.isRead ?? false,
    isFlagged: data.data?.isFlagged ?? false,
  };
}
