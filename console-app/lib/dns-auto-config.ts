import { detectDnsProvider } from './dns';

export interface AutoDnsDetectResult {
  provider: string | null;
  message: string;
}

/**
 * Auto-detects the DNS provider (GoDaddy, Cloudflare, Namecheap, Route 53, etc.)
 * based on the domain's authoritative nameservers.
 * Does NOT alter DNS records or assume ownership without user verification.
 */
export async function detectDomainDnsProvider(domainName: string): Promise<AutoDnsDetectResult> {
  try {
    const provider = await detectDnsProvider(domainName);
    console.log(`[dns-detect] Domain "${domainName}" detected DNS provider: ${provider ?? 'unknown'}`);
    return {
      provider,
      message: provider ? `Detected DNS provider: ${provider}` : 'DNS provider could not be detected automatically.',
    };
  } catch (err: unknown) {
    console.warn(`[dns-detect] Error detecting DNS provider for "${domainName}":`, err);
    return {
      provider: null,
      message: 'Could not detect DNS provider.',
    };
  }
}
