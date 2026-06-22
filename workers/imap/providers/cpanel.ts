export interface CpanelCreds {
  host: string;
  adminUser: string;
  adminToken: string;
  masterPass: string;
}

export async function discoverCpanelUsers(creds: CpanelCreds): Promise<string[]> {
  // WHM API v1: list all email accounts across all domains
  const base = `https://${creds.host}:2087`;
  const headers = { Authorization: `whm ${creds.adminUser}:${creds.adminToken}` };

  // First get all hosted domains
  const domainsRes = await fetch(`${base}/json-api/get_domain_info?api.version=1`, { headers });
  if (!domainsRes.ok) throw new Error(`WHM API error: ${domainsRes.statusText}`);
  const domainData = await domainsRes.json() as { data?: { domains?: Array<{ domain: string }> } };
  const domains = domainData.data?.domains?.map(d => d.domain) ?? [];

  const emails: string[] = [];
  for (const domain of domains) {
    const res = await fetch(`${base}/json-api/listpopswithdisk?api.version=1&domain=${domain}`, { headers });
    if (!res.ok) continue;
    const data = await res.json() as { data?: { pops?: Array<{ email: string }> } };
    for (const pop of data.data?.pops ?? []) {
      if (pop.email && !pop.email.startsWith('nobody@') && !pop.email.startsWith('noreply@')) {
        emails.push(pop.email);
      }
    }
  }
  return [...new Set(emails)];
}
