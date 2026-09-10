// Shared by app/api/push/preview/route.ts (browser-authenticated, for the
// service worker's Web Push handler) and the JMAP relay route
// (device-record-authenticated, for the mobile FCM path) — both need the
// same "what's the latest unread email" lookup, just with credentials
// sourced differently.

export interface JmapAuth {
  serverUrl: string;
  authHeader: string;
}

export interface EmailPreview {
  id: string;
  threadId: string;
  from?: { name?: string | null; email?: string }[] | null;
  subject?: string | null;
  preview?: string | null;
  receivedAt?: string | null;
}

export interface PushPreviewResult {
  email: EmailPreview | null;
  unreadTotal: number;
}

class PreviewFetchError extends Error {}

export async function fetchPushPreview(creds: JmapAuth): Promise<PushPreviewResult> {
  const sessionRes = await fetch(`${creds.serverUrl}/.well-known/jmap`, {
    headers: { Authorization: creds.authHeader },
  });
  if (!sessionRes.ok) throw new PreviewFetchError('JMAP session failed');
  const session = (await sessionRes.json()) as {
    apiUrl?: string;
    primaryAccounts?: Record<string, string>;
  };
  const apiUrl = session.apiUrl;
  const accountId = session.primaryAccounts?.['urn:ietf:params:jmap:mail'];
  if (!apiUrl || !accountId) throw new PreviewFetchError('Incomplete JMAP session');

  const inboxRes = await fetch(apiUrl, {
    method: 'POST',
    headers: { Authorization: creds.authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
      methodCalls: [
        ['Mailbox/query', { accountId, filter: { role: 'inbox' }, limit: 1 }, 'mb'],
      ],
    }),
  });
  if (!inboxRes.ok) throw new PreviewFetchError('JMAP mailbox query failed');

  const inboxData = (await inboxRes.json()) as {
    methodResponses: [string, Record<string, unknown>, string][];
  };
  const inboxBody = inboxData.methodResponses.find(
    ([method]) => method === 'Mailbox/query',
  )?.[1] as { ids?: string[] } | undefined;
  const inboxId = inboxBody?.ids?.[0];

  if (!inboxId) return { email: null, unreadTotal: 0 };

  const jmapRes = await fetch(apiUrl, {
    method: 'POST',
    headers: { Authorization: creds.authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
      methodCalls: [
        [
          'Email/query',
          {
            accountId,
            filter: { operator: 'AND', conditions: [{ inMailbox: inboxId }, { notKeyword: '$seen' }] },
            sort: [{ property: 'receivedAt', isAscending: false }],
            limit: 1,
            calculateTotal: true,
          },
          'eq',
        ],
        [
          'Email/get',
          {
            accountId,
            '#ids': { resultOf: 'eq', name: 'Email/query', path: '/ids' },
            properties: ['id', 'threadId', 'from', 'subject', 'preview', 'receivedAt'],
          },
          'eg',
        ],
      ],
    }),
  });
  if (!jmapRes.ok) throw new PreviewFetchError('JMAP request failed');

  const data = (await jmapRes.json()) as {
    methodResponses: [string, Record<string, unknown>, string][];
  };

  let email: EmailPreview | null = null;
  let unreadTotal = 0;
  for (const [method, body] of data.methodResponses) {
    if (method === 'Email/query') {
      unreadTotal = (body as { total?: number }).total ?? 0;
    }
    if (method === 'Email/get') {
      const list = (body as { list?: EmailPreview[] }).list ?? [];
      email = list[0] ?? null;
    }
  }

  return { email, unreadTotal };
}
