'use client';
import { useState, useEffect } from 'react';
import { DomainsStyles } from '../domains-theme';

interface DomainDetail {
  id: string; domain: string; verified: boolean; verify_token: string; dnsProvider: string | null;
  created_at?: string; flux_domain_id?: string | null;
  /** true = mail routes here; false = verified but MX still points elsewhere; null = could not check. */
  mxLive?: boolean | null;
  /** The actual MX exchange hosts this domain currently resolves to, lowest priority first. */
  mxHosts?: string[] | null;
  /** Whether this domain can SEND — a separate failure from where its mail arrives. */
  sending?: {
    ready: boolean;
    sesIdentityExists: boolean;
    sesVerified: boolean;
    dkimStatus: string | null;
    sandbox: boolean;
    error?: string;
  };
}
interface DnsRecord { type: string; host: string; value: string; priority?: number; description: string; }
interface DnsResult { record: string; status: string; error?: string; }
interface AutoResult { ok: boolean; results: DnsResult[]; }
interface FluxUserLite { id: string; name: string; emailAddress: string; usedDiskQuota?: number; quotas?: { maxDiskQuota?: number } }
interface ReadinessResult {
  checked: boolean; missing?: string[]; sourceTotal?: number; hereTotal?: number;
  sending?: { ready: boolean; dkimStatus: string | null; sandbox: boolean };
}

// 'conflict' = we refused to touch a record the customer owns (e.g. an SPF
// record that is not ours); 'skipped'/'unchanged' = nothing needed doing.
const FAILED_STATUSES = ['error', 'conflict'];
const isFailed = (status: string) => FAILED_STATUSES.includes(status);

/** Routes answer with { ok, results }, but an auth/validation error is { error }. */
function toAutoResult(d: Partial<AutoResult> & { error?: string }): AutoResult {
  if (Array.isArray(d.results)) return { ok: d.ok === true, results: d.results };
  return { ok: false, results: [{ record: 'request', status: 'error', error: d.error ?? 'Unexpected response from the DNS provider' }] };
}

const STEPS = ['Verify Ownership', 'Configure DNS', 'Done'];

// autoSupport = we have a real API integration for auto-adding records
const PROVIDERS: Record<string, { label: string; color: string; logo: string; autoSupport: boolean }> = {
  cloudflare:   { label: 'Cloudflare',     color: '#f97316', logo: '🟠', autoSupport: true  },
  godaddy:      { label: 'GoDaddy',        color: '#1aad1a', logo: '🟢', autoSupport: true  },
  digitalocean: { label: 'DigitalOcean',   color: '#0069ff', logo: '🔵', autoSupport: true  },
  porkbun:      { label: 'Porkbun',        color: '#ef4444', logo: '🐷', autoSupport: true  },
  bluehost:     { label: 'Bluehost',       color: '#0072c6', logo: '🔵', autoSupport: false },
  namecheap:    { label: 'Namecheap',      color: '#de3723', logo: '🔴', autoSupport: false },
  route53:      { label: 'AWS Route 53',   color: '#ff9900', logo: '🟡', autoSupport: false },
  squarespace:  { label: 'Squarespace',    color: '#555555', logo: '⬛', autoSupport: false },
  manual:       { label: 'Other / Manual', color: '#64748b', logo: '📋', autoSupport: false },
};

const AUTO_PROVIDERS = ['cloudflare', 'godaddy', 'digitalocean', 'porkbun'];

// Provider portal URLs + step-by-step instructions
const PORTAL: Record<string, { url: string; host: string; steps: string[] }> = {
  godaddy:      { url: 'https://developer.godaddy.com/en/personal-access-token', host: 'developer.godaddy.com/en/personal-access-token', steps: ['Log in with your GoDaddy account', 'Click Create Personal Access Token', 'Give it Domains read + write access', 'Copy the token (shown once) → paste below', 'Already have an API Key + Secret? Use those fields instead'] },
  digitalocean: { url: 'https://cloud.digitalocean.com/account/api/tokens', host: 'cloud.digitalocean.com/account/api/tokens', steps: ['Click Generate New Token', 'Enable Read + Write access', 'Copy the token → paste below'] },
  porkbun:      { url: 'https://porkbun.com/account/api',                  host: 'porkbun.com/account/api',                  steps: ['Enable API Access for your domain', 'Copy the API Key and Secret Key → paste below'] },
};

function fmtBytes(b: number): string {
  if (b >= 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(0) + ' KB';
  return b + ' B';
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
);
const WarnIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
);
const ClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
);
const HelpIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 2-3 4" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
);
const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
);

export default function DomainSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const [domainId, setDomainId] = useState('');
  const [domain, setDomain] = useState<DomainDetail | null>(null);
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [verifyRecord, setVerifyRecord] = useState<DnsRecord | null>(null);
  const [step, setStep] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [gdToken, setGdToken] = useState('');
  const [gdKey, setGdKey]       = useState('');
  const [gdSecret, setGdSecret] = useState('');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const [cfToken, setCfToken]   = useState('');
  const [doToken, setDoToken]   = useState('');
  const [pbKey, setPbKey]       = useState('');
  const [pbSecret, setPbSecret] = useState('');

  const [autoZones, setAutoZones]   = useState<{ id: string; name: string }[]>([]);
  const [autoZoneId, setAutoZoneId] = useState('');
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoResult, setAutoResult]   = useState<AutoResult | null>(null);

  // Real mailboxes on this domain, from the same source /dashboard/users reads.
  const [mailboxes, setMailboxes] = useState<FluxUserLite[]>([]);
  const [mailboxesLoaded, setMailboxesLoaded] = useState(false);
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  function loadDomain(id: string) {
    return fetch(`/api/domains/${id}`)
      .then(r => r.json() as Promise<DomainDetail & { records: DnsRecord[]; verifyRecord: DnsRecord }>)
      .then(d => {
        setDomain(d);
        setRecords(d.records ?? []);
        setVerifyRecord(d.verifyRecord ?? null);
        if (d.verified) setStep(1);
        if (d.dnsProvider && PROVIDERS[d.dnsProvider]) setActiveProvider(d.dnsProvider);
        return d;
      });
  }

  useEffect(() => {
    params.then(({ id }) => {
      setDomainId(id);
      loadDomain(id);
      fetch('/api/users')
        .then(r => r.json() as Promise<{ domains: Array<{ domainId: string; users: FluxUserLite[] }> }>)
        .then(d => {
          const mine = d.domains.find(x => x.domainId === id);
          setMailboxes(mine?.users ?? []);
          setMailboxesLoaded(true);
        })
        .catch(() => setMailboxesLoaded(true));
      fetch(`/api/domains/${id}/migration-readiness`)
        .then(r => r.json() as Promise<ReadinessResult>)
        .then(setReadiness)
        .catch(() => {});
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function refreshDomain() {
    if (!domainId) return;
    setRefreshing(true);
    await loadDomain(domainId);
    setRefreshing(false);
  }

  // Cloudflare OAuth callback
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('cf_connected') === '1') {
      fetch('/api/auth/cloudflare/token')
        .then(r => r.json() as Promise<{ token: { accessToken: string } | null }>)
        .then(({ token }) => { if (token?.accessToken) { setCfToken(token.accessToken); setActiveProvider('cloudflare'); } });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  function providerRequest(extra: object = {}): [string, object] {
    if (activeProvider === 'cloudflare')   return [`/api/domains/${domainId}/cloudflare`,   { cfToken, zoneId: autoZoneId, ...extra }];
    if (activeProvider === 'godaddy')      return [`/api/domains/${domainId}/godaddy`,      { gdToken, gdKey, gdSecret, zoneDomain: autoZoneId, ...extra }];
    if (activeProvider === 'digitalocean') return [`/api/domains/${domainId}/digitalocean`, { doToken, zoneDomain: autoZoneId, ...extra }];
    if (activeProvider === 'porkbun')      return [`/api/domains/${domainId}/porkbun`,      { pbKey, pbSecret, zoneDomain: autoZoneId, ...extra }];
    return ['', {}];
  }

  async function postProvider<T>(extra: object = {}): Promise<T> {
    const [url, body] = providerRequest(extra);
    if (!url) return { error: 'Select a DNS provider first.' } as T;
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return await res.json() as T;
    } catch {
      return { error: 'Could not reach the server. Please try again.' } as T;
    }
  }

  const canConnect = activeProvider === 'cloudflare'   ? !!cfToken
    : activeProvider === 'godaddy'      ? (!!gdToken || (!!gdKey && !!gdSecret))
    : activeProvider === 'digitalocean' ? !!doToken
    : activeProvider === 'porkbun'      ? (!!pbKey && !!pbSecret)
    : false;

  async function triggerVerify() {
    setVerifying(true); setVerifyResult(null);
    const d = await fetch(`/api/domains/${domainId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify' }),
    }).then(r => r.json() as Promise<{ verified?: boolean; error?: string }>);
    setVerifying(false);
    if (d.verified) {
      setVerifyResult({ ok: true, message: 'Verified! Proceeding to DNS setup…' });
      setDomain(p => p ? { ...p, verified: true } : p);
      setTimeout(() => setStep(1), 900);
    } else {
      setVerifyResult({ ok: false, message: d.error ?? 'TXT record not found yet. DNS changes take up to a few minutes.' });
    }
  }

  async function loadZones() {
    setAutoLoading(true); setAutoZones([]); setAutoZoneId(''); setAutoResult(null);
    const d = await postProvider<{ zones?: { id: string; name: string }[]; error?: string }>({ action: 'zones' });
    setAutoLoading(false);
    if (d.error) {
      setAutoResult({ ok: false, results: [{ record: 'connection', status: 'error', error: d.error }] });
    } else if (!d.zones || d.zones.length === 0) {
      setAutoResult({ ok: false, results: [{ record: 'domain lookup', status: 'error', error: `${domain?.domain} was not found in this account. Make sure you're using the correct API key for the account that owns this domain.` }] });
    } else {
      setAutoZones(d.zones);
      if (d.zones.length === 1) setAutoZoneId(d.zones[0].id);
    }
  }

  async function autoVerify() {
    if (!autoZoneId) return;
    setAutoLoading(true); setAutoResult(null);
    const d = toAutoResult(await postProvider<Partial<AutoResult> & { error?: string }>({ verifyOnly: true }));
    setAutoLoading(false); setAutoResult(d);
    if (d.ok) pollVerify();
  }

  async function pollVerify() {
    const delays = [1000, 2000, 3000, 5000, 8000, 12000, 15000, 15000];
    setVerifying(true);
    setVerifyResult({ ok: true, message: 'Record added — confirming with your DNS provider…' });

    for (let i = 0; i < delays.length; i++) {
      await new Promise(r => setTimeout(r, delays[i]));
      let verified = false;
      try {
        const d = await fetch(`/api/domains/${domainId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify' }),
        }).then(r => r.json() as Promise<{ verified?: boolean }>);
        verified = Boolean(d.verified);
      } catch { /* transient network error — keep polling rather than failing the run */ }
      if (verified) {
        setVerifying(false);
        setVerifyResult({ ok: true, message: 'Verified! Proceeding to DNS setup…' });
        setDomain(p => p ? { ...p, verified: true } : p);
        setTimeout(() => setStep(1), 900);
        return;
      }
    }

    setVerifying(false);
    setVerifyResult({ ok: false, message: 'The record was added, but it has not propagated yet. This is normal — click Verify again in a minute.' });
  }

  async function applyRecords() {
    if (!autoZoneId) return;

    try {
      const r = await fetch(`/api/domains/${domainId}/migration-readiness`);
      if (r.ok) {
        const g = await r.json() as ReadinessResult;
        const warnings: string[] = [];
        if (g.checked && g.missing && g.missing.length > 0) {
          const names = g.missing.slice(0, 8).join('\n  ');
          warnings.push(
            `${g.missing.length} of ${g.sourceTotal} address(es) on this domain in your source mailbox `
            + `do not have a mailbox here yet:\n\n  ${names}`
            + (g.missing.length > 8 ? `\n  …and ${g.missing.length - 8} more` : '')
            + '\n\nSwitching mail here now means new messages to those addresses will bounce until they are migrated.');
        }
        if (g.sending && !g.sending.ready) {
          warnings.push(g.sending.sandbox
            ? 'Our sending provider is still in sandbox mode, so outbound mail from this domain will only reach pre-approved recipients until that is lifted.'
            : `Outbound mail from this domain is not verified yet (DKIM status: ${g.sending.dkimStatus ?? 'unknown'}). Until it verifies, people on this domain can receive mail but cannot send any. Publishing the DKIM records below is what starts that check.`);
        }
        if (warnings.length && !confirm(warnings.join('\n\n———\n\n') + '\n\nSwitch anyway?')) return;
      }
    } catch { /* best-effort — do not block the publish on this check failing */ }

    setAutoLoading(true); setAutoResult(null);
    const d = toAutoResult(await postProvider<Partial<AutoResult> & { error?: string }>());
    setAutoLoading(false); setAutoResult(d);
    if (d.ok) {
      setDomain(p => p ? { ...p, mxLive: true } : p);
      refreshDomain();
    }
  }

  function copy(text: string, idx: number) {
    navigator.clipboard.writeText(text).then(() => { setCopiedIdx(idx); setTimeout(() => setCopiedIdx(null), 1500); });
  }

  function copyAllRecords() {
    if (!domain) return;
    const lines = [
      `; Arham Workspace DNS zone records for ${domain.domain}`,
      ...records.map(r => {
        const host = r.host === domain.domain ? '@' : r.host.replace(`.${domain.domain}`, '');
        return r.type === 'MX'
          ? `${host}\tIN\tMX\t${r.priority ?? 10}\t${r.value}.`
          : r.type === 'TXT'
            ? `${host}\tIN\tTXT\t"${r.value}"`
            : `${host}\tIN\t${r.type}\t${r.value}.`;
      }),
    ];
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopiedIdx(-1); setTimeout(() => setCopiedIdx(null), 1500);
    });
  }

  function switchProvider(key: string) {
    setActiveProvider(prev => prev === key ? null : key);
    setAutoZones([]); setAutoZoneId(''); setAutoResult(null);
  }

  async function deleteDomain(force = false) {
    if (!domain) return;
    if (!force && !confirm(`Remove ${domain.domain}? All email users under this domain will lose access.`)) return;
    setDeleting(true); setDeleteError('');
    let res: Response;
    try {
      res = await fetch(`/api/domains/${domainId}${force ? '?force=true' : ''}`, { method: 'DELETE' });
    } catch {
      setDeleting(false);
      setDeleteError('Could not reach the server. Please try again.');
      return;
    }
    if (res.ok) { window.location.href = '/dashboard/domains'; return; }
    setDeleting(false);
    const d = await res.json().catch(() => ({})) as {
      error?: string; requiresForce?: boolean; mailboxCount?: number; mailboxes?: string[];
    };
    if (res.status === 409 && d.requiresForce) {
      const list = (d.mailboxes ?? []).slice(0, 5).join('\n  ');
      const more = (d.mailboxCount ?? 0) > 5 ? `\n  …and ${(d.mailboxCount ?? 0) - 5} more` : '';
      const ok = confirm(
        `${domain.domain} still has ${d.mailboxCount} mailbox(es):\n  ${list}${more}\n\n`
        + 'Deleting the domain permanently destroys these mailboxes and all their mail. This cannot be undone.\n\nDelete anyway?',
      );
      if (ok) await deleteDomain(true);
      return;
    }
    setDeleteError(d.error ?? `Could not remove ${domain.domain}.`);
  }

  if (!domain) return <div className="domainspage" style={{ color: 'var(--d-muted)', padding: '2rem' }}><DomainsStyles />Loading…</div>;

  const detected = domain.dnsProvider && PROVIDERS[domain.dnsProvider] ? domain.dnsProvider : null;
  const providerList = [...new Set([...(detected ? [detected] : []), ...AUTO_PROVIDERS, 'manual'])];
  const zpProps = { canConnect, loading: autoLoading, zones: autoZones, zoneId: autoZoneId, onZoneChange: setAutoZoneId, onFindZones: loadZones, result: autoResult, color: PROVIDERS[activeProvider ?? 'cloudflare']?.color ?? '#2563eb' };

  const dkimOk = domain.sending?.dkimStatus === 'SUCCESS';
  const dkimFailed = domain.sending?.dkimStatus === 'FAILED' || domain.sending?.dkimStatus === 'TEMPORARY_FAILURE';
  const fullyReady = domain.verified && domain.mxLive === true && domain.sending?.ready === true;
  const needsAttention = domain.verified && (domain.mxLive === false || domain.sending?.ready === false);

  function renderProviderPanel(mode: 'verify' | 'dns') {
    const applyLabel = mode === 'verify' ? 'Add verification record & verify →' : '⚡ Add all mail records';
    const onApply    = mode === 'verify' ? autoVerify : applyRecords;

    if (!activeProvider || activeProvider === 'manual') return null;
    if (!PROVIDERS[activeProvider]?.autoSupport) return <ManualPanel provider={activeProvider} domain={domain!.domain} />;

    if (activeProvider === 'cloudflare') {
      return (
        <div style={{ borderTop: '1px solid var(--d-border)', paddingTop: '1.25rem' }}>
          <a href={`/api/auth/cloudflare?domainId=${domainId}`} className="d-btn d-btn-primary" style={{ marginBottom: '1rem' }}>
            🟠 Log in to Cloudflare →
          </a>
          {cfToken && <div style={{ background: 'var(--d-green-soft)', border: '1px solid #BFE5D2', borderRadius: 8, padding: '.6rem 1rem', marginBottom: '1rem', color: 'var(--d-green)', fontWeight: 600, fontSize: '0.875rem' }}>✓ Cloudflare connected</div>}
          {(!cfToken) && (
            <div style={{ marginBottom: '.75rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--d-muted)', marginBottom: '.35rem' }}>Or paste a token manually — use the <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--d-accent)', fontWeight: 600 }}>&quot;Edit zone DNS&quot; template</a></div>
              <input value={cfToken} onChange={e => { setCfToken(e.target.value); setAutoZones([]); }} placeholder="Cloudflare API Token" type="password" className="d-inp" style={{ width: '100%' }} />
            </div>
          )}
          <ZonePicker {...zpProps} zoneLabel="Cloudflare Zone" applyLabel={applyLabel} onApply={onApply} />
        </div>
      );
    }

    return (
      <div style={{ borderTop: '1px solid var(--d-border)', paddingTop: '1.25rem' }}>
        <PopupKeyConnect
          provider={activeProvider}
          fields={
            activeProvider === 'digitalocean' ? [
              { id: 'do-token', placeholder: 'DigitalOcean Personal Access Token', value: doToken, onChange: (v: string) => { setDoToken(cleanCredential(v)); setAutoZones([]); } },
            ] : activeProvider === 'porkbun' ? [
              { id: 'pb-key',    placeholder: 'Porkbun API Key',    value: pbKey,    onChange: (v: string) => { setPbKey(cleanCredential(v)); setAutoZones([]); }    },
              { id: 'pb-secret', placeholder: 'Porkbun API Secret', value: pbSecret, onChange: (v: string) => { setPbSecret(cleanCredential(v)); setAutoZones([]); } },
            ] : [
              { id: 'gd-token',  placeholder: 'GoDaddy Personal Access Token (gd_pat_…)', value: gdToken,  onChange: (v: string) => { setGdToken(cleanCredential(v)); setAutoZones([]); } },
              { id: 'gd-key',    placeholder: '…or legacy API Key',                       value: gdKey,    onChange: (v: string) => { setGdKey(cleanCredential(v)); setAutoZones([]); } },
              { id: 'gd-secret', placeholder: '…and API Secret',                          value: gdSecret, onChange: (v: string) => { setGdSecret(cleanCredential(v)); setAutoZones([]); } },
            ]
          }
        />
        <ZonePicker {...zpProps} zoneLabel={activeProvider === 'cloudflare' ? 'Cloudflare Zone' : 'Domain'} applyLabel={applyLabel} onApply={onApply} />
      </div>
    );
  }

  return (
    <div className="domainspage" style={{ maxWidth: 920 }}>
      <DomainsStyles />

      <a href="/dashboard/domains" className="d-back">← Back to Domains</a>

      <div className="d-detailhead">
        <div>
          <div className="d-detailtitle">
            <h1>{domain.domain}</h1>
            <span className={`d-pill ${fullyReady ? 'ok' : needsAttention ? 'warn' : 'neutral'}`}>
              {fullyReady ? 'Production Ready' : needsAttention ? 'Action Required' : domain.verified ? 'Pending Sending Setup' : 'Pending Verification'}
            </span>
          </div>
          <div className="d-detailmeta">
            {domain.created_at && <>Added {fmtDate(domain.created_at)}</>}
            {domain.flux_domain_id && <> &middot; ID #{domain.flux_domain_id}</>}
          </div>
        </div>
        <button onClick={refreshDomain} className="d-btn" disabled={refreshing}>
          <RefreshIcon /> {refreshing ? 'Checking…' : 'Check records now'}
        </button>
      </div>

      {/* Health matrix — always visible once ownership is verified; the four
          boxes are independent failure modes (ownership / routing / DKIM /
          sending), each backed by its own field in GET /api/domains/[id]. */}
      {domain.verified && (
        <div className="d-hero" style={{ marginBottom: 20 }}>
          <div className="d-hero-top">
            <div>
              <div className={`d-hero-title ${fullyReady ? 'ok' : needsAttention ? 'warn' : ''}`}>
                {fullyReady ? <CheckIcon /> : needsAttention ? <WarnIcon /> : <ClockIcon />}
                <span>
                  {fullyReady
                    ? `${domain.domain} is fully operational for mail`
                    : `${domain.domain} is not fully ready for email yet`}
                </span>
              </div>
              <div className="d-hero-desc">
                {fullyReady
                  ? 'MX records resolve to Arham Workspace and DKIM authentication is verified with Amazon SES.'
                  : domain.mxLive === false
                    ? 'Mail sent to this domain from outside the platform is still landing at your previous provider until MX is switched.'
                    : domain.sending && !domain.sending.ready
                      ? (domain.sending.sandbox
                        ? 'Our sending provider is in sandbox mode — outbound mail only reaches pre-approved recipients.'
                        : 'Outbound mail is being rejected by the sending provider until DKIM verifies.')
                      : 'Some checks are still pending.'}
              </div>
            </div>
          </div>

          <div className="d-matrix">
            <div className="d-mbox">
              <div>
                <div className="d-mbox-top">
                  <span className="d-mbox-label">1. Ownership</span>
                  <span className="d-mbox-icon" style={{ color: 'var(--d-green)' }}><CheckIcon /></span>
                </div>
                <div className="d-mbox-title">Verified</div>
                <div className="d-mbox-desc">Confirmed via the _arham-verify TXT record.</div>
              </div>
            </div>

            <div className={`d-mbox ${domain.mxLive === false ? 'warn' : ''}`}>
              <div>
                <div className="d-mbox-top">
                  <span className="d-mbox-label">2. Mail Routing</span>
                  <span className="d-mbox-icon" style={{ color: domain.mxLive === true ? 'var(--d-green)' : domain.mxLive === false ? 'var(--d-red)' : 'var(--d-muted)' }}>
                    {domain.mxLive === true ? <CheckIcon /> : domain.mxLive === false ? <WarnIcon /> : <HelpIcon />}
                  </span>
                </div>
                <div className="d-mbox-title">
                  {domain.mxLive === true ? 'Routed to Arham' : domain.mxLive === false ? 'Not Routed to Arham' : 'Not Detected'}
                </div>
                <div className="d-mbox-desc">
                  {domain.mxLive === true && `mxLive: true. Resolving to ${domain.mxHosts?.[0] ?? 'mail.arhamworkspace.tech'}.`}
                  {domain.mxLive === false && `mxLive: false. Resolving to ${domain.mxHosts?.[0] ?? 'another provider'}.`}
                  {domain.mxLive === null && 'No MX record found, or the lookup timed out.'}
                </div>
              </div>
              {domain.mxLive === false && (
                <div className="d-mbox-foot"><a href="#dns-records">Switch mail here →</a></div>
              )}
            </div>

            <div className={`d-mbox ${dkimFailed ? 'warn' : ''}`}>
              <div>
                <div className="d-mbox-top">
                  <span className="d-mbox-label">3. DKIM Tokens</span>
                  <span className="d-mbox-icon" style={{ color: dkimOk ? 'var(--d-green)' : dkimFailed ? 'var(--d-red)' : 'var(--d-amber)' }}>
                    {dkimOk ? <CheckIcon /> : dkimFailed ? <WarnIcon /> : <ClockIcon />}
                  </span>
                </div>
                <div className="d-mbox-title">
                  {dkimOk ? 'DKIM Active' : domain.sending?.dkimStatus === 'PENDING' ? 'DKIM Pending' : dkimFailed ? 'DKIM Failed' : 'Not Started'}
                </div>
                <div className="d-mbox-desc">
                  {dkimOk ? '2048-bit RSA keys verified with Amazon SES.'
                    : domain.sending?.dkimStatus === 'PENDING' ? '2048-bit RSA keys propagating — publish the CNAME records below.'
                    : dkimFailed ? 'Keys did not verify in time — republish the CNAMEs, then check records again.'
                    : 'Publish the DKIM CNAME records below to begin verification.'}
                </div>
              </div>
              <div className="d-mbox-foot">SES identity: {domain.sending?.sesIdentityExists ? 'Registered' : 'Not registered'}</div>
            </div>

            <div className={`d-mbox ${domain.sending && !domain.sending.ready ? 'warn' : ''}`}>
              <div>
                <div className="d-mbox-top">
                  <span className="d-mbox-label">4. Sending Access</span>
                  <span className="d-mbox-icon" style={{ color: domain.sending?.ready ? 'var(--d-green)' : 'var(--d-red)' }}>
                    {domain.sending?.ready ? <CheckIcon /> : <WarnIcon />}
                  </span>
                </div>
                <div className="d-mbox-title">{domain.sending?.ready ? 'Ready' : 'Not Ready'}</div>
                <div className="d-mbox-desc">
                  {domain.sending?.ready ? 'Outbound delivery active in production mode.' : 'Outbound mail held until DKIM verifies.'}
                </div>
              </div>
              <div className="d-mbox-foot">SES account: {domain.sending?.sandbox ? 'Sandbox' : 'Production'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Migration readiness safeguard — real data from /migration-readiness:
          addresses that exist in a connected source mailbox but have no
          mailbox here yet. Switching MX before these exist means new mail to
          them bounces the instant it takes effect. */}
      {readiness?.checked && (readiness.missing?.length ?? 0) > 0 && (
        <div className="d-safeguard" style={{ marginBottom: 20 }}>
          <div className="d-safeguard-top">
            <span className="d-safeguard-icon" style={{ color: 'var(--d-red)' }}><WarnIcon /></span>
            <div style={{ flex: 1 }}>
              <div className="d-safeguard-title">
                {readiness.missing!.length} address{readiness.missing!.length !== 1 ? 'es' : ''} from your source mailbox {readiness.missing!.length !== 1 ? 'have' : 'has'} no mailbox here yet
              </div>
              <div className="d-safeguard-desc">
                If mail is routed here before these mailboxes exist, incoming messages to them will bounce.
              </div>
              <div className="d-missing-grid">
                {readiness.missing!.slice(0, 9).map(email => (
                  <div key={email} className="d-missing-chip">
                    <span className="d-mono">{email}</span>
                    <span className="d-missing-badge">Missing</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12 }}>
                <a href="/dashboard/users" className="d-btn d-btn-primary">Create missing mailboxes first</a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step bar */}
      <div style={{ display: 'flex', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--d-border)', marginBottom: 20, boxShadow: 'var(--d-shadow-s)' }}>
        {STEPS.map((s, i) => (
          <div key={s} onClick={() => i < step && setStep(i)}
            style={{ flex: 1, padding: '.75rem 1rem', fontSize: '0.85rem', fontWeight: i === step ? 700 : 500, cursor: i < step ? 'pointer' : 'default', borderRight: i < STEPS.length - 1 ? '1px solid var(--d-border)' : 'none', background: i === step ? 'var(--d-accent)' : i < step ? 'var(--d-accent-soft)' : 'var(--d-surface)', color: i === step ? '#fff' : i < step ? 'var(--d-green)' : 'var(--d-muted)' }}>
            <span style={{ marginRight: '.4rem', opacity: .8 }}>{i < step ? '✓' : `${i + 1}.`}</span>{s}
          </div>
        ))}
      </div>

      {/* ── Step 0: Verify ── */}
      {step === 0 && (
        domain.verified ? (
          <div className="d-addcard" style={{ marginBottom: 20 }}>
            <p style={{ color: 'var(--d-green)', fontWeight: 600, marginBottom: '.75rem' }}>✓ Domain already verified.</p>
            <button onClick={() => setStep(1)} className="d-btn d-btn-primary">Next: Configure DNS →</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
            <div className="d-addcard">
              <div style={{ fontWeight: 700, color: 'var(--d-ink2)', marginBottom: '.25rem' }}>
                {detected ? `Verify via ${PROVIDERS[detected]?.label} — one click` : 'Connect your DNS provider to verify instantly'}
              </div>
              <p style={{ color: 'var(--d-muted)', fontSize: '0.82rem', marginBottom: '1.25rem' }}>
                We&apos;ll add the verification TXT record automatically — no copy-pasting.
              </p>
              <ProviderTabs detected={detected} providers={providerList} active={activeProvider} onSwitch={switchProvider} />
              {renderProviderPanel('verify')}
              {verifyResult && <Alert ok={verifyResult.ok} msg={verifyResult.message} />}
            </div>

            <div className="d-addcard">
              <div style={{ fontWeight: 700, color: 'var(--d-ink2)', marginBottom: '.25rem' }}>Or add the TXT record manually</div>
              <p style={{ color: 'var(--d-muted)', fontSize: '0.82rem', marginBottom: '1rem' }}>Add this in your DNS provider&apos;s dashboard, then click Check.</p>
              {verifyRecord && <DnsRow rec={verifyRecord} idx={0} copiedIdx={copiedIdx} onCopy={copy} />}
              <button onClick={triggerVerify} disabled={verifying} className="d-btn d-btn-primary" style={{ marginTop: '.5rem' }}>
                {verifying ? 'Checking DNS…' : 'Check Verification'}
              </button>
            </div>
          </div>
        )
      )}

      {/* ── Step 1: Configure DNS ── */}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }} id="dns-records">
          <div className="d-addcard">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: 'var(--d-ink2)' }}>
                {detected ? `Add mail DNS records via ${PROVIDERS[detected]?.label}` : 'Add mail DNS records'}
              </span>
              {detected && <span className="d-tag" style={{ background: 'var(--d-accent-soft)', color: 'var(--d-accent)' }}>{PROVIDERS[detected].label} detected</span>}
            </div>
            <p style={{ color: 'var(--d-muted)', fontSize: '0.82rem', marginBottom: '1.25rem' }}>
              MX, SPF, DMARC and DKIM CNAMEs — published in one click.
              {(cfToken || doToken || gdToken || (gdKey && gdSecret) || (pbKey && pbSecret)) ? ' Your credentials are already filled in.' : ''}
            </p>
            <ProviderTabs detected={detected} providers={providerList} active={activeProvider} onSwitch={switchProvider} />
            {renderProviderPanel('dns')}
          </div>

          <div className="d-addcard" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '16px 18px' }}>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--d-ink2)' }}>DNS records to configure</div>
                <p style={{ color: 'var(--d-muted)', fontSize: '0.8rem', marginTop: 2 }}>Publish these at your DNS host. Works with any provider.</p>
              </div>
              <button onClick={copyAllRecords} className="d-btn">{copiedIdx === -1 ? 'Copied!' : 'Copy all (zone format)'}</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="d-rectable">
                <thead>
                  <tr><th>Type</th><th>Host</th><th>Value</th><th>Priority</th><th>Purpose</th><th></th></tr>
                </thead>
                <tbody>
                  {records.map((r, i) => (
                    <tr key={i}>
                      <td><span className="d-rectype">{r.type}</span></td>
                      <td className="d-rechost">{r.host}</td>
                      <td className="d-recval">{r.value}</td>
                      <td className="d-cell-muted">{r.priority ?? '—'}</td>
                      <td className="d-cell-muted" style={{ fontSize: 12 }}>{r.description}</td>
                      <td>
                        <button className={`d-copybtn ${copiedIdx === i ? 'copied' : ''}`} onClick={() => copy(`${r.host}\t${r.value}`, i)}>
                          {copiedIdx === i ? '✓' : 'Copy'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <button onClick={() => setStep(2)} className="d-btn d-btn-primary" style={{ alignSelf: 'flex-start' }}>Mark done &amp; finish →</button>
        </div>
      )}

      {/* ── Step 2: Done ── */}
      {step === 2 && (
        <div className="d-addcard" style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
          <div style={{ fontWeight: 800, color: 'var(--d-ink)', fontSize: '1.3rem', marginBottom: '.5rem' }}>{domain.domain} is set up!</div>
          <p style={{ color: 'var(--d-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>Domain verified and DNS configured.</p>
          <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/dashboard/users" className="d-btn d-btn-primary">Create email users</a>
            <a href="/dashboard/migration" className="d-btn">Import email</a>
          </div>
        </div>
      )}

      {/* Mailbox utilization — real storage fields only (name, email, used,
          quota, progress bar). No fake role or status badges. */}
      <div className="d-addcard" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: '16px 18px' }}>
          <div style={{ fontWeight: 700, color: 'var(--d-ink2)' }}>Mailbox utilization on this domain</div>
          <p style={{ color: 'var(--d-muted)', fontSize: '0.8rem', marginTop: 2 }}>Storage consumed per mailbox against its provisioned quota.</p>
        </div>
        {!mailboxesLoaded ? (
          <div className="d-empty">Loading…</div>
        ) : mailboxes.length === 0 ? (
          <div className="d-empty">No mailboxes on this domain yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="d-mtable">
              <thead>
                <tr><th>User</th><th>Email</th><th>Storage</th><th>Usage</th></tr>
              </thead>
              <tbody>
                {mailboxes.map(u => {
                  const used = u.usedDiskQuota ?? 0;
                  const quota = u.quotas?.maxDiskQuota ?? 0;
                  const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : null;
                  return (
                    <tr key={u.id}>
                      <td className="d-mname">{u.name || u.emailAddress}</td>
                      <td className="d-mmail">{u.emailAddress}</td>
                      <td>{quota > 0 ? <>{fmtBytes(used)} <span style={{ color: 'var(--d-muted)' }}>/ {fmtBytes(quota)}</span></> : fmtBytes(used)}</td>
                      <td>
                        {pct !== null ? (
                          <div className="d-musagewrap">
                            <div className="d-musagebar"><i style={{ width: `${pct}%`, background: pct >= 90 ? 'var(--d-red)' : pct >= 75 ? 'var(--d-amber)' : 'var(--d-accent)' }} /></div>
                            <span className="d-musagepct">{pct}%</span>
                          </div>
                        ) : <span className="d-cell-muted">No quota</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ padding: '11px 18px', background: 'var(--d-surface2)', borderTop: '1px solid var(--d-border)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: 'var(--d-muted)' }}>{mailboxes.length} mailbox{mailboxes.length !== 1 ? 'es' : ''} on this domain</span>
          <a href="/dashboard/users" style={{ color: 'var(--d-accent)', fontWeight: 700, textDecoration: 'none' }}>Manage all mailboxes →</a>
        </div>
      </div>

      {/* Danger zone */}
      <div className="d-danger">
        <div className="d-danger-title"><TrashIcon /> Danger zone: delete domain</div>
        <div className="d-danger-desc">
          {mailboxes.length > 0
            ? <>Cannot delete <code className="d-mono">{domain.domain}</code> while <strong>{mailboxes.length} mailbox{mailboxes.length !== 1 ? 'es' : ''}</strong> {mailboxes.length !== 1 ? 'are' : 'is'} attached. Remove or migrate them first, or delete anyway to permanently destroy them and their mail.</>
            : <>Removing <code className="d-mono">{domain.domain}</code> also removes it from the mail server and its sending identity. This cannot be undone.</>}
        </div>
        {deleteError && <div style={{ color: 'var(--d-red)', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{deleteError}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="d-btn d-btn-danger" onClick={() => deleteDomain(false)} disabled={deleting}>
            {deleting ? 'Removing…' : `Delete ${domain.domain}`}
          </button>
          {mailboxes.length > 0 && <span style={{ fontSize: 12, color: 'var(--d-muted)' }}>{mailboxes.length} mailbox{mailboxes.length !== 1 ? 'es' : ''} will be destroyed if you continue</span>}
        </div>
      </div>
    </div>
  );
}

/* ── Provider tabs ───────────────────────────────────────────────────────── */
function ProviderTabs({ detected, providers, active, onSwitch }: {
  detected: string | null; providers: string[]; active: string | null; onSwitch: (k: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
      {providers.map(key => {
        const p = PROVIDERS[key];
        const isActive   = active === key;
        const isDetected = key === detected;
        return (
          <button key={key} onClick={() => onSwitch(key)}
            style={{ display: 'flex', alignItems: 'center', gap: '.4rem', padding: '.55rem .95rem', borderRadius: 9, border: `2px solid ${isActive ? p.color : isDetected ? `${p.color}55` : 'var(--d-border)'}`, background: isActive ? `${p.color}12` : isDetected ? `${p.color}06` : '#fff', color: isActive ? p.color : isDetected ? p.color : 'var(--d-muted)', fontWeight: isActive || isDetected ? 700 : 500, cursor: 'pointer', fontSize: '0.82rem', transition: 'all .15s' }}>
            <span style={{ fontSize: '1rem' }}>{p.logo}</span>
            {p.label}
            {isDetected && !isActive && <span style={{ fontSize: '0.62rem', background: p.color, color: '#fff', padding: '.1rem .3rem', borderRadius: 4, marginLeft: '.2rem' }}>Detected</span>}
          </button>
        );
      })}
    </div>
  );
}

function cleanCredential(v: string): string {
  return v.replace(/\s+/g, '');
}

function PopupKeyConnect({ provider, fields }: {
  provider: string;
  fields: { id: string; placeholder: string; value: string; onChange: (v: string) => void }[];
}) {
  const [waiting, setWaiting] = useState(false);
  const [pulse, setPulse] = useState(true);
  const p = PROVIDERS[provider];
  const portal = PORTAL[provider];

  useEffect(() => {
    if (waiting) return;
    const t = setInterval(() => setPulse(v => !v), 1100);
    return () => clearInterval(t);
  }, [waiting]);

  function openPopup() {
    if (!portal) return;
    const w = 860, h = 620;
    const left = Math.round(window.screenX + (window.outerWidth  - w) / 2);
    const top  = Math.round(window.screenY + (window.outerHeight - h) / 2);
    const popup = window.open(portal.url, `${provider}_portal`, `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`);
    if (!popup) { window.open(portal.url, '_blank'); return; }
    setWaiting(true);
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer); setWaiting(false);
        setTimeout(() => document.getElementById(fields[0]?.id)?.focus(), 120);
      }
    }, 500);
  }

  return (
    <div style={{ marginBottom: '1rem' }}>
      <button onClick={openPopup} className="d-btn d-btn-primary" style={{ background: waiting ? '#166534' : p.color, marginBottom: '1rem' }}>
        {p.logo} {waiting ? `${p.label} is open — paste below…` : `Open ${p.label} →`}
      </button>

      {portal && (
        <div style={{
          background: pulse && !waiting ? `${p.color}10` : `${p.color}06`,
          border: `1.5px solid ${pulse && !waiting ? `${p.color}55` : `${p.color}22`}`,
          borderRadius: 9, padding: '.75rem 1rem', marginBottom: '.85rem',
          transition: 'background 0.7s ease, border-color 0.7s ease',
        }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: p.color, letterSpacing: '.4px', textTransform: 'uppercase', marginBottom: '.45rem' }}>
            {waiting ? `✓ Tab open — complete these steps:` : `Opens ${portal.host}`}
          </div>
          <ol style={{ margin: 0, padding: '0 0 0 1.1rem', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
            {portal.steps.map((s, i) => (
              <li key={i} style={{ fontSize: '0.82rem', color: 'var(--d-ink2)', fontWeight: i === portal.steps.length - 1 ? 700 : 400 }}>{s}</li>
            ))}
          </ol>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        {fields.map(f => (
          <input key={f.id} id={f.id} value={f.value} onChange={e => f.onChange(e.target.value)}
            placeholder={f.placeholder} type="password" className="d-inp" style={{ width: '100%' }} />
        ))}
      </div>
    </div>
  );
}

function ManualPanel({ provider, domain }: { provider: string; domain: string }) {
  const links: Record<string, { label: string; href: string }> = {
    namecheap:   { label: 'Namecheap Advanced DNS',  href: `https://ap.www.namecheap.com/Domains/DomainControlPanel/${domain}/advancedns` },
    route53:     { label: 'AWS Route 53',            href: 'https://console.aws.amazon.com/route53/v2/hostedzones' },
    squarespace: { label: 'Squarespace DNS settings', href: 'https://account.squarespace.com/domains' },
    bluehost:    { label: 'Bluehost Domain Manager', href: 'https://my.bluehost.com/hosting/app#/domains' },
  };
  const link = links[provider];
  const p = PROVIDERS[provider] ?? { label: provider.charAt(0).toUpperCase() + provider.slice(1), color: '#64748b', logo: '📋', autoSupport: false };
  return (
    <div style={{ borderTop: '1px solid var(--d-border)', paddingTop: '1.25rem' }}>
      <div style={{ background: `${p.color}0d`, border: `1px solid ${p.color}33`, borderRadius: 9, padding: '1rem 1.25rem', marginBottom: '.75rem' }}>
        <div style={{ fontWeight: 700, color: p.color, marginBottom: '.4rem' }}>{p.logo} {p.label}</div>
        <p style={{ color: 'var(--d-muted)', fontSize: '0.875rem', marginBottom: link ? '.75rem' : 0 }}>
          This provider doesn&apos;t offer a public API — add the records below manually in your DNS dashboard.
        </p>
        {link && (
          <a href={link.href} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', padding: '.55rem 1.1rem', background: p.color, color: '#fff', borderRadius: 7, fontWeight: 700, fontSize: '0.82rem', textDecoration: 'none' }}>
            Open {link.label} →
          </a>
        )}
      </div>
    </div>
  );
}

function ZonePicker({ canConnect, loading, zones, zoneId, onZoneChange, onFindZones, result, zoneLabel, applyLabel, onApply, color }: {
  canConnect: boolean; loading: boolean;
  zones: { id: string; name: string }[]; zoneId: string; onZoneChange: (v: string) => void;
  onFindZones: () => void; result: AutoResult | null;
  zoneLabel: string; applyLabel: string; onApply: () => void; color: string;
}) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.65rem', alignItems: 'flex-end', marginTop: '.5rem' }}>
        <button onClick={onFindZones} disabled={!canConnect || loading}
          style={{ padding: '.65rem 1.15rem', background: color, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.875rem', cursor: canConnect ? 'pointer' : 'not-allowed', opacity: !canConnect || loading ? .6 : 1 }}>
          {loading && zones.length === 0 ? 'Connecting…' : 'Find Zones →'}
        </button>
        {zones.length > 0 && (
          <>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--d-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: '.3rem' }}>{zoneLabel}</div>
              <select value={zoneId} onChange={e => onZoneChange(e.target.value)} className="d-inp" style={{ width: '100%' }}>
                <option value="">Select…</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </div>
            <button onClick={onApply} disabled={!zoneId || loading} className="d-btn d-btn-primary" style={{ background: '#16a34a', whiteSpace: 'nowrap' }}>
              {loading && zones.length > 0 ? 'Working…' : applyLabel}
            </button>
          </>
        )}
      </div>
      {result && (
        <div style={{ marginTop: '1rem', background: result.ok ? 'var(--d-green-soft)' : 'var(--d-amber-soft)', border: `1px solid ${result.ok ? '#BFE5D2' : '#F3DDBB'}`, borderRadius: 8, padding: '1rem' }}>
          <div style={{ fontWeight: 700, color: result.ok ? 'var(--d-green)' : 'var(--d-amber)', marginBottom: '.5rem' }}>
            {result.ok ? (applyLabel.includes('verify') ? '✓ Record added! Checking verification…' : '✓ All DNS records added!') : '⚠ Completed with issues'}
          </div>
          {result.results.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: '.5rem', fontSize: '0.78rem', color: isFailed(r.status) ? 'var(--d-red)' : r.status === 'skipped' ? 'var(--d-amber)' : 'var(--d-muted)', marginBottom: '.2rem' }}>
              <span>{isFailed(r.status) ? '✗' : r.status === 'skipped' ? 'ℹ' : '✓'}</span>
              <span>{r.record} — <em>{r.error ?? r.status}</em></span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function DnsRow({ rec, idx, copiedIdx, onCopy }: {
  rec: DnsRecord; idx: number; copiedIdx: number | null; onCopy: (t: string, i: number) => void;
}) {
  return (
    <div style={{ background: 'var(--d-surface2)', border: '1px solid var(--d-border)', borderRadius: 8, padding: '1rem', marginBottom: '.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', marginBottom: '.6rem' }}>
        <div style={{ color: 'var(--d-muted)', fontSize: '0.78rem' }}>{rec.description}</div>
        <button onClick={() => onCopy(`${rec.host}\t${rec.value}`, idx)} className={`d-copybtn ${copiedIdx === idx ? 'copied' : ''}`}>
          {copiedIdx === idx ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 2fr', gap: '.75rem', alignItems: 'start' }}>
        <span className="d-rectype" style={{ textAlign: 'center' }}>{rec.type}</span>
        <div>
          <div style={{ color: 'var(--d-muted)', fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '.15rem' }}>Host</div>
          <code className="d-mono" style={{ color: 'var(--d-accent)', fontSize: '0.8rem', wordBreak: 'break-all' }}>{rec.host}</code>
          {rec.priority != null && <div style={{ color: 'var(--d-muted)', fontSize: '0.7rem', marginTop: '.1rem' }}>Priority: {rec.priority}</div>}
        </div>
        <div>
          <div style={{ color: 'var(--d-muted)', fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '.15rem' }}>Value</div>
          <code className="d-mono" style={{ color: 'var(--d-ink2)', fontSize: '0.8rem', wordBreak: 'break-all' }}>{rec.value}</code>
        </div>
      </div>
    </div>
  );
}

function Alert({ ok, msg }: { ok: boolean; msg: string }) {
  return (
    <div style={{ background: ok ? 'var(--d-green-soft)' : 'var(--d-red-soft)', border: `1px solid ${ok ? '#BFE5D2' : '#F3C6C4'}`, borderRadius: 8, padding: '.75rem 1rem', color: ok ? 'var(--d-green)' : 'var(--d-red)', fontSize: '0.875rem', marginTop: '1rem' }}>
      {ok ? '✓ ' : '✗ '}{msg}
    </div>
  );
}
