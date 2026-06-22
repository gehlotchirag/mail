export interface ImapCredentials {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
}

export function buildImapCredentials(
  sourceType: string,
  creds: Record<string, string>,
  targetEmail: string
): ImapCredentials {
  switch (sourceType) {
    case 'cpanel': {
      // Dovecot master-user: targetuser*masteruser
      const host = creds.host;
      const masterUser = `${targetEmail}*${creds.adminUser}`;
      return { host, port: 993, secure: true, auth: { user: masterUser, pass: creds.masterPass } };
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
    case 'gsuite':
    case 'zoho':
      // These use REST API paths in their own processors — IMAP is never called for them
      throw new Error(`${sourceType} does not use IMAP master-user auth; this code path should not be reached`);
    default:
      throw new Error(`Unknown source type: ${sourceType}`);
  }
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
  'Zoho Mail':          'inbox',  // some Zoho accounts use this as root
  'Sent Messages':      'sent',
};
