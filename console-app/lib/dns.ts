import dns from 'dns/promises';

export interface DnsSetupRecord {
  type: string;
  host: string;
  value: string;
  priority?: number;
  description: string;
}

const MAIL_HOST = process.env.MAIL_HOST ?? 'mail.arhamworkspace.tech';

export function getRequiredDnsRecords(domain: string): DnsSetupRecord[] {
  return [
    {
      type: 'MX', host: domain, value: MAIL_HOST, priority: 10,
      description: 'Routes incoming email to the Arham mail server',
    },
    {
      type: 'TXT', host: domain,
      value: `v=spf1 include:${MAIL_HOST.replace('mail.', '')} include:sendinblue.com ~all`,
      description: 'SPF record — authorises the mail server to send on your behalf',
    },
    {
      type: 'TXT', host: `_dmarc.${domain}`,
      value: `v=DMARC1; p=none; rua=mailto:postmaster@${domain}`,
      description: 'DMARC policy — enables email delivery reports',
    },
    {
      type: 'CNAME', host: `autoconfig.${domain}`, value: MAIL_HOST,
      description: 'Thunderbird/Outlook auto-configuration',
    },
    {
      type: 'CNAME', host: `autodiscover.${domain}`, value: MAIL_HOST,
      description: 'Outlook auto-discovery',
    },
  ];
}

export function getVerifyRecord(domain: string, token: string): DnsSetupRecord {
  return {
    type: 'TXT', host: `_arham-verify.${domain}`, value: token,
    description: 'Domain ownership verification — can be removed after verification',
  };
}

export async function verifyDomainOwnership(domain: string, token: string): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(`_arham-verify.${domain}`);
    return records.flat().some(r => r === token);
  } catch {
    return false;
  }
}

export async function checkMxRecord(domain: string): Promise<boolean> {
  try {
    const records = await dns.resolveMx(domain);
    const mailHost = process.env.MAIL_HOST ?? 'mail.arhamworkspace.tech';
    return records.some(r => r.exchange.toLowerCase().replace(/\.$/, '') === mailHost.toLowerCase());
  } catch {
    return false;
  }
}
