export interface ImapCredentials {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass?: string; accessToken?: string | (() => Promise<string>) };
}

/**
 * The per-mailbox password map, tolerant of how it survived encryption: it is stored
 * as JSON inside the credentials blob, so it arrives as a string, and a malformed
 * one must degrade to "no per-user password" rather than fail the whole migration.
 */
function parsePerUserPasswords(raw: unknown): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, string>;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
  } catch {
    console.warn('[imap] imapPasswords was not valid JSON — ignoring per-user credentials');
    return {};
  }
}

export function buildImapCredentials(
  sourceType: string,
  creds: Record<string, string>,
  targetEmail: string
): ImapCredentials {
  switch (sourceType) {
    case 'cpanel': {
      const masterUser = `${targetEmail}*${creds.adminUser}`;
      return { host: creds.host, port: 993, secure: true, auth: { user: masterUser, pass: creds.masterPass } };
    }
    case 'dovecot': {
      const masterUser = `${targetEmail}*${creds.masterUser}`;
      return {
        host: creds.host,
        port: Number(creds.port ?? 993),
        secure: true,
        auth: { user: masterUser, pass: creds.masterPass },
      };
    }
    case 'gsuite': {
      const saJson = JSON.parse(creds.serviceAccountJson ?? '{}') as {
        client_email: string; private_key: string;
      };
      return {
        host: 'imap.gmail.com', port: 993, secure: true,
        auth: {
          user: targetEmail,
          accessToken: async () => {
            const { buildGSuiteAccessToken } = await import('./providers/gsuite.js');
            return buildGSuiteAccessToken(saJson, targetEmail);
          },
        },
      };
    }
    case 'zoho': {
      // Zoho has no master-user IMAP: a credential authenticates exactly one mailbox.
      // So prefer a password provisioned for THIS specific address before falling back
      // to a single app password (which only ever works for the account that owns it,
      // and silently fails as "Command failed" for everyone else).
      const region = creds.region ?? 'in';
      const host = `imappro.zoho.${region}`;

      // Written by the console's "prepare mailboxes" step, which uses Zoho's admin
      // password-reset API to obtain one credential per user without needing each
      // person to generate an app password by hand.
      const perUser = parsePerUserPasswords(creds.imapPasswords)[targetEmail.toLowerCase()];
      if (perUser) {
        return { host, port: 993, secure: true, auth: { user: targetEmail, pass: perUser } };
      }
      if (creds.imapPassword) {
        return { host, port: 993, secure: true, auth: { user: targetEmail, pass: creds.imapPassword } };
      }
      return { host, port: 993, secure: true, auth: { user: targetEmail, accessToken: creds.accessToken } };
    }
    default:
      throw new Error(`Unknown source type: ${sourceType}`);
  }
}

/**
 * ImapFlow only accepts a string `accessToken`; a callback would be serialised
 * into the SASL payload verbatim. Resolve lazily-built tokens (gsuite) here so
 * every caller hands ImapFlow a plain auth object.
 */
export async function resolveImapAuth(
  creds: ImapCredentials,
): Promise<{ user: string; pass?: string; accessToken?: string }> {
  const { user, pass, accessToken } = creds.auth;
  if (typeof accessToken === 'function') {
    return { user, accessToken: await accessToken() };
  }
  if (accessToken) return { user, accessToken };
  return { user, pass };
}

export const FOLDER_ROLE_MAP: Record<string, string> = {
  // Generic
  'INBOX':              'inbox',
  'Sent':               'sent',   'Sent Items':    'sent',   'Sent Mail': 'sent',
  'Drafts':             'drafts', 'Draft':         'drafts',
  'Trash':              'trash',  'Deleted Items': 'trash',  'Deleted':   'trash',
  'Spam':               'junk',   'Junk':          'junk',   'Junk Mail': 'junk',
  'Archive':            'archive',
  'Flagged':            'flagged','Starred':        'flagged',
  // Gmail
  '[Gmail]/Sent Mail':  'sent',
  '[Gmail]/Drafts':     'drafts',
  '[Gmail]/Trash':      'trash',
  '[Gmail]/Spam':       'junk',
  '[Gmail]/All Mail':   'archive',
  '[Gmail]/Starred':    'flagged',
  // Zoho
  'Zoho Mail':          'inbox',
  'Sent Messages':      'sent',
};

/**
 * Folders that are pure VIEWS over messages stored elsewhere. Skipping these
 * loses nothing, because every message in them is also migrated via the folder it
 * actually lives in — and migrating them would import the same message twice.
 *
 * The bar for this list is deliberately high: a folder only belongs here if its
 * contents are provably duplicated in another folder we already migrate.
 *
 * Explicitly NOT here, because they can hold messages that exist nowhere else:
 *   - Outbox    — queued/scheduled mail that has not been sent yet
 *   - Snoozed   — Zoho MOVES snoozed messages into it; they leave the Inbox
 *   - Templates — user-authored content
 *   - [Gmail]/All Mail — archived Gmail lives ONLY here; it is mapped to the
 *                        `archive` role in FOLDER_ROLE_MAP and must be migrated
 * Those are handled by the empty-folder rule instead: they are only recreated when
 * they actually contain something, so the common case (empty) stays clean while a
 * tenant who used them keeps their mail.
 *
 * Compared case-insensitively, and against the last path segment, so
 * "INBOX/Starred" is caught too.
 */
const SKIP_FOLDER_NAMES = new Set([
  '[gmail]/starred',
  '[gmail]/important',
]);

export function shouldSkipFolder(folderName: string): boolean {
  const full = folderName.trim().toLowerCase();
  const leaf = full.split('/').pop() ?? full;
  return SKIP_FOLDER_NAMES.has(full) || SKIP_FOLDER_NAMES.has(leaf);
}
