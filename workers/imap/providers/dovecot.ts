export interface DovecotCreds {
  host: string;
  port?: string;
  masterUser: string;
  masterPass: string;
  userList?: string;
}

export function discoverDovecotUsers(creds: DovecotCreds): string[] {
  // Users are provided manually in the userList field (one per line)
  const raw = creds.userList ?? '';
  return raw
    .split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(s => s.includes('@') && s.length > 3);
}
