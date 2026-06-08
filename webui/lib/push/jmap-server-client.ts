import { JMAPClient } from '@/lib/jmap/client';
import type { StalwartCredentials } from '@/lib/stalwart/credentials';

/**
 * Build a server-side JMAPClient from the credentials extracted from the
 * incoming request, then call connect() so that apiUrl is populated.
 * connect() is required — JMAPClient.request() throws if apiUrl is empty.
 */
export async function createConnectedJmapClient(creds: StalwartCredentials): Promise<JMAPClient> {
  let client: JMAPClient;

  if (creds.authHeader.startsWith('Bearer ')) {
    const token = creds.authHeader.slice(7);
    client = JMAPClient.withBearer(creds.serverUrl, token, creds.username, async () => null);
  } else {
    // Basic auth — decode "Basic <base64(user:pass)>" to extract the password.
    const encoded = creds.authHeader.replace(/^Basic\s+/i, '');
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    // Username may contain special chars but not ':', so split on first colon only.
    const colonIdx = decoded.indexOf(':');
    const password = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : '';
    client = new JMAPClient(creds.serverUrl, creds.username, password);
  }

  await client.connect();
  return client;
}
