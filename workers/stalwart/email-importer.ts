const STALWART_URL = process.env.STALWART_URL ?? 'http://localhost:18080';
const ADMIN_AUTH = Buffer.from(
  `${process.env.STALWART_ADMIN_USER ?? 'admin@arhamfintech.ai'}:${process.env.STALWART_ADMIN_PASS ?? ''}`
).toString('base64');

const authHeader = () => ({ Authorization: `Basic ${ADMIN_AUTH}` });

export async function uploadBlob(accountId: string, rawMessage: Buffer): Promise<{ blobId: string; size: number }> {
  const res = await fetch(`${STALWART_URL}/jmap/upload/${accountId}/`, {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'message/rfc822' },
    body: rawMessage,
  });
  if (!res.ok) throw new Error(`Blob upload failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { blobId: string; size: number };
  return { blobId: data.blobId, size: data.size };
}

// Map IMAP flags to JMAP keywords
function flagsToKeywords(flags: Set<string>): Record<string, true> {
  const kw: Record<string, true> = {};
  if (flags.has('\\Seen'))    kw['$seen'] = true;
  if (flags.has('\\Flagged')) kw['$flagged'] = true;
  if (flags.has('\\Answered'))kw['$answered'] = true;
  if (flags.has('\\Draft'))   kw['$draft'] = true;
  return kw;
}

export async function importEmail(params: {
  accountId: string;
  blobId: string;
  mailboxId: string;
  flags: Set<string>;
  receivedAt?: Date;
}): Promise<string> {
  const { accountId, blobId, mailboxId, flags, receivedAt } = params;
  const res = await fetch(`${STALWART_URL}/jmap/`, {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
      methodCalls: [[
        'Email/import',
        {
          accountId,
          emails: {
            '1': {
              blobId,
              mailboxIds: { [mailboxId]: true },
              keywords: flagsToKeywords(flags),
              receivedAt: receivedAt?.toISOString(),
            },
          },
        },
        'a',
      ]],
    }),
  });
  if (!res.ok) throw new Error(`Email/import failed: ${res.status}`);
  const data = await res.json() as { methodResponses: Array<[string, { created?: Record<string, { id: string }> }]> };
  const emailId = data.methodResponses?.[0]?.[1]?.created?.['1']?.id;
  if (!emailId) throw new Error('Email/import returned no emailId');
  return emailId;
}
