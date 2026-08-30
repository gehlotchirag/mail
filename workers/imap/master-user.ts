export interface ImapCredentials {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass?: string; accessToken?: string | (() => Promise<string>) };
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
    case 'zoho':
      throw new Error('zoho does not use IMAP — this code path should not be reached');
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
