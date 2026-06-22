export interface GSuiteCreds {
  domain: string;
  serviceAccountJson: string;
  adminEmail: string;
}

export async function discoverGSuiteUsers(creds: GSuiteCreds): Promise<string[]> {
  // Use Google Admin SDK Directory API with service account + domain-wide delegation
  // Requires googleapis package — installed separately if gsuite migration is needed
  try {
    const { google } = await import('googleapis');
    const serviceAccount = JSON.parse(creds.serviceAccountJson);
    const auth = new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/admin.directory.user.readonly'],
      subject: creds.adminEmail,
    });
    const admin = google.admin({ version: 'directory_v1', auth });
    const users: string[] = [];
    let pageToken: string | undefined;
    do {
      const res = await admin.users.list({ domain: creds.domain, maxResults: 500, pageToken, fields: 'nextPageToken,users(primaryEmail,suspended)' });
      for (const u of res.data.users ?? []) {
        if (u.primaryEmail && !u.suspended) users.push(u.primaryEmail);
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return users;
  } catch (err) {
    throw new Error(`Google Workspace discovery failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
