'use client';
import { useState, useEffect } from 'react';

interface DomainDetail {
  id: string; domain: string; verified: boolean; verify_token: string; dnsProvider: string | null;
  /** true = mail routes here; false = verified but MX still points elsewhere; null = could not check. */
  mxLive?: boolean | null;
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
  // GoDaddy replaced the old API Key + Secret pair with a single Personal Access
  // Token (gd_pat_…). The steps below match the page they actually land on.
  godaddy:      { url: 'https://developer.godaddy.com/en/personal-access-token', host: 'developer.godaddy.com/en/personal-access-token', steps: ['Log in with your GoDaddy account', 'Click Create Personal Access Token', 'Give it Domains read + write access', 'Copy the token (shown once) → paste below', 'Already have an API Key + Secret? Use those fields instead'] },
  digitalocean: { url: 'https://cloud.digitalocean.com/account/api/tokens', host: 'cloud.digitalocean.com/account/api/tokens', steps: ['Click Generate New Token', 'Enable Read + Write access', 'Copy the token → paste below'] },
  porkbun:      { url: 'https://porkbun.com/account/api',                  host: 'porkbun.com/account/api',                  steps: ['Enable API Access for your domain', 'Copy the API Key and Secret Key → paste below'] },
};

export default function DomainSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const [domainId, setDomainId] = useState('');
  const [domain, setDomain] = useState<DomainDetail | null>(null);
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [verifyRecord, setVerifyRecord] = useState<DnsRecord | null>(null);
  const [step, setStep] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  // GoDaddy now issues one Personal Access Token instead of a key/secret pair.
  const [gdToken, setGdToken] = useState('');
  // GoDaddy issues a single Personal Access Token to new developer accounts, but
  // existing accounts still hold an API Key + Secret pair and both remain valid.
  // Offer both rather than forcing anyone to mint a new credential.
  const [gdKey, setGdKey]       = useState('');
  const [gdSecret, setGdSecret] = useState('');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // Credentials — shared across steps so user only enters once
  const [cfToken, setCfToken]   = useState('');
  const [doToken, setDoToken]   = useState('');
  const [pbKey, setPbKey]       = useState('');
  const [pbSecret, setPbSecret] = useState('');

  // Zone picker
  const [autoZones, setAutoZones]   = useState<{ id: string; name: string }[]>([]);
  const [autoZoneId, setAutoZoneId] = useState('');
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoResult, setAutoResult]   = useState<AutoResult | null>(null);

  useEffect(() => {
    params.then(({ id }) => {
      setDomainId(id);
      fetch(`/api/domains/${id}`)
        .then(r => r.json() as Promise<DomainDetail & { records: DnsRecord[]; verifyRecord: DnsRecord }>)
        .then(d => {
          setDomain(d);
          setRecords(d.records ?? []);
          setVerifyRecord(d.verifyRecord ?? null);
          if (d.verified) setStep(1);
          if (d.dnsProvider && PROVIDERS[d.dnsProvider]) setActiveProvider(d.dnsProvider);
        });
    });
  }, [params]);

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

  // Build the request URL + body for the active provider.
  // Provider credentials are ALWAYS sent in a POST body — never in a query
  // string, where they would be captured by access logs, browser history and
  // any proxy in between.
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return await res.json() as T;
    } catch {
      return { error: 'Could not reach the server. Please try again.' } as T;
    }
  }

  // canConnect — true when the user has entered enough credentials
  const canConnect = activeProvider === 'cloudflare'   ? !!cfToken
    : activeProvider === 'godaddy'      ? (!!gdToken || (!!gdKey && !!gdSecret))
    : activeProvider === 'digitalocean' ? !!doToken
    : activeProvider === 'porkbun'      ? (!!pbKey && !!pbSecret)
    : false;

  async function triggerVerify() {
    setVerifying(true); setVerifyResult(null);
    const d = await fetch(`/api/domains/${domainId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify' }),
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

  // We just wrote the TXT through the provider's own API, so the record exists —
  // the only question is when a resolver will admit it. A single check 2 seconds
  // later almost always lost that race and told the customer "DNS can take up to
  // 48 hours" for a record that was already live, leaving them to retry by hand.
  // Back off over ~1 minute instead; the server checks the zone's authoritative
  // nameservers first, so this normally succeeds on the first attempt.
  async function pollVerify() {
    const delays = [1000, 2000, 3000, 5000, 8000, 12000, 15000, 15000];
    setVerifying(true);
    setVerifyResult({ ok: true, message: 'Record added — confirming with your DNS provider…' });

    for (let i = 0; i < delays.length; i++) {
      await new Promise(r => setTimeout(r, delays[i]));
      let verified = false;
      try {
        const d = await fetch(`/api/domains/${domainId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'verify' }),
        }).then(r => r.json() as Promise<{ verified?: boolean }>);
        verified = Boolean(d.verified);
      } catch {
        // transient network error — keep polling rather than failing the run
      }
      if (verified) {
        setVerifying(false);
        setVerifyResult({ ok: true, message: 'Verified! Proceeding to DNS setup…' });
        setDomain(p => p ? { ...p, verified: true } : p);
        setTimeout(() => setStep(1), 900);
        return;
      }
    }

    setVerifying(false);
    setVerifyResult({
      ok: false,
      message: 'The record was added, but it has not propagated yet. This is normal — click Verify again in a minute.',
    });
  }

  async function applyRecords() {
    if (!autoZoneId) return;

    // Switching MX affects EVERY address on this domain, not just the ones
    // already migrated — anyone who exists in the old system but has no mailbox
    // here yet starts bouncing the instant this takes effect. Checking this by
    // hand, once, is how a real cutover got done safely earlier; it should not
    // take a manual investigation every time.
    try {
      const r = await fetch(`/api/domains/${domainId}/migration-readiness`);
      if (r.ok) {
        const g = await r.json() as {
          checked: boolean; missing?: string[]; sourceTotal?: number; hereTotal?: number;
          sending?: { ready: boolean; dkimStatus: string | null; sandbox: boolean };
        };
        const warnings: string[] = [];
        if (g.checked && g.missing && g.missing.length > 0) {
          const names = g.missing.slice(0, 8).join('\n  ');
          warnings.push(
            `${g.missing.length} of ${g.sourceTotal} address(es) on this domain in your source mailbox `
            + `do not have a mailbox here yet:\n\n  ${names}`
            + (g.missing.length > 8 ? `\n  …and ${g.missing.length - 8} more` : '')
            + '\n\nSwitching mail here now means new messages to those addresses will bounce until they are '
            + 'migrated.');
        }
        // Taking over MX only settles where mail ARRIVES. A domain whose sending
        // identity is unverified can receive everything and reply to none of it, with
        // every outbound message bouncing back to the sender — silently, because
        // nothing failed on our side. Say so before the cutover, not after.
        if (g.sending && !g.sending.ready) {
          warnings.push(g.sending.sandbox
            ? 'Our sending provider is still in sandbox mode, so outbound mail from this domain will only '
              + 'reach pre-approved recipients until that is lifted.'
            : `Outbound mail from this domain is not verified yet (DKIM status: ${g.sending.dkimStatus ?? 'unknown'}). `
              + 'Until it verifies, people on this domain can receive mail but cannot send any. Publishing the '
              + 'DKIM records below is what starts that check.');
        }
        if (warnings.length && !confirm(warnings.join('\n\n———\n\n') + '\n\nSwitch anyway?')) return;
      }
    } catch { /* best-effort — do not block the publish on this check failing */ }

    setAutoLoading(true); setAutoResult(null);
    const d = toAutoResult(await postProvider<Partial<AutoResult> & { error?: string }>());
    setAutoLoading(false); setAutoResult(d);
    if (d.ok) setDomain(p => p ? { ...p, mxLive: true } : p);
  }

  function copy(text: string, idx: number) {
    navigator.clipboard.writeText(text).then(() => { setCopiedIdx(idx); setTimeout(() => setCopiedIdx(null), 1500); });
  }

  function switchProvider(key: string) {
    setActiveProvider(prev => prev === key ? null : key);
    setAutoZones([]); setAutoZoneId(''); setAutoResult(null);
  }

  if (!domain) return <div style={{ color: '#3b5f8a', padding: '2rem' }}>Loading…</div>;

  const detected = domain.dnsProvider && PROVIDERS[domain.dnsProvider] ? domain.dnsProvider : null;
  const providerList = [...new Set([...(detected ? [detected] : []), ...AUTO_PROVIDERS, 'manual'])];

  // Common zone picker props for both steps
  const zpProps = { canConnect, loading: autoLoading, zones: autoZones, zoneId: autoZoneId, onZoneChange: setAutoZoneId, onFindZones: loadZones, result: autoResult, color: PROVIDERS[activeProvider ?? 'cloudflare']?.color ?? '#2563eb' };

  function renderProviderPanel(mode: 'verify' | 'dns') {
    const applyLabel = mode === 'verify' ? 'Add verification record & verify →' : '⚡ Add all mail records';
    const onApply    = mode === 'verify' ? autoVerify : applyRecords;

    if (!activeProvider || activeProvider === 'manual') return null;
    if (!PROVIDERS[activeProvider]?.autoSupport) return <ManualPanel provider={activeProvider} domain={domain!.domain} />;

    if (activeProvider === 'cloudflare') {
      return (
        <div style={{ borderTop: '1px solid #dbeafe', paddingTop: '1.25rem' }}>
          <a href={`/api/auth/cloudflare?domainId=${domainId}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', padding: '.7rem 1.4rem', background: PROVIDERS.cloudflare.color, color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: '0.9rem', textDecoration: 'none', marginBottom: '1rem' }}>
            🟠 Log in to Cloudflare →
          </a>
          {cfToken && <div style={{ background: 'rgba(22,163,74,.06)', border: '1px solid rgba(22,163,74,.2)', borderRadius: 8, padding: '.6rem 1rem', marginBottom: '1rem', color: '#16a34a', fontWeight: 600, fontSize: '0.875rem' }}>✓ Cloudflare connected</div>}
          {(!cfToken) && (
            <div style={{ marginBottom: '.75rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#3b5f8a', marginBottom: '.35rem' }}>Or paste a token manually — use the <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontWeight: 600 }}>"Edit zone DNS" template</a></div>
              <input value={cfToken} onChange={e => { setCfToken(e.target.value); setAutoZones([]); }} placeholder="Cloudflare API Token" type="password" style={inp()} />
            </div>
          )}
          <ZonePicker {...zpProps} zoneLabel="Cloudflare Zone" applyLabel={applyLabel} onApply={onApply} />
        </div>
      );
    }

    // GoDaddy / DigitalOcean / Porkbun — popup button + key inputs
    return (
      <div style={{ borderTop: '1px solid #dbeafe', paddingTop: '1.25rem' }}>
        <PopupKeyConnect
          provider={activeProvider}
          fields={
            activeProvider === 'digitalocean' ? [
              { id: 'do-token', placeholder: 'DigitalOcean Personal Access Token', value: doToken, onChange: (v: string) => { setDoToken(cleanCredential(v)); setAutoZones([]); } },
            ] : activeProvider === 'porkbun' ? [
              { id: 'pb-key',    placeholder: 'Porkbun API Key',    value: pbKey,    onChange: (v: string) => { setPbKey(cleanCredential(v)); setAutoZones([]); }    },
              { id: 'pb-secret', placeholder: 'Porkbun API Secret', value: pbSecret, onChange: (v: string) => { setPbSecret(cleanCredential(v)); setAutoZones([]); } },
            ] : [
              // Either the new single token OR the legacy pair. The API route picks
              // the right Authorization scheme from whichever arrives.
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
    <div style={{ maxWidth: 780 }}>
      <a href="/dashboard/domains" style={{ color: '#3b5f8a', fontSize: '0.85rem' }}>← Back to domains</a>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '.75rem 0 2rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f2040', letterSpacing: '-0.5px' }}>{domain.domain}</h1>
        <span style={{ fontSize: '0.75rem', padding: '.25rem .65rem', borderRadius: 6, fontWeight: 700, background: domain.verified ? 'rgba(22,163,74,.12)' : 'rgba(251,191,36,.12)', color: domain.verified ? '#16a34a' : '#d97706' }}>
          {domain.verified ? '✓ Verified' : '⏳ Pending verification'}
        </span>
        {detected && (
          <span style={{ fontSize: '0.75rem', padding: '.25rem .65rem', borderRadius: 6, fontWeight: 600, background: `${PROVIDERS[detected].color}12`, color: PROVIDERS[detected].color, border: `1px solid ${PROVIDERS[detected].color}30` }}>
            {PROVIDERS[detected].logo} DNS: {PROVIDERS[detected].label}
          </span>
        )}
      </div>

      {/* Visible regardless of which step is open. "Verified" only proves
          ownership — it says nothing about whether mail actually arrives here,
          and nothing else in the product ever surfaced that gap. A domain sat
          fully verified for over a week with every inbound message still
          landing at the old provider before anyone noticed. */}
      {domain.verified && domain.mxLive === false && (
        <div style={{ background: 'rgba(220,38,38,.06)', border: '1px solid rgba(220,38,38,.25)', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.9rem' }}>⚠ Mail is not routed here yet</div>
            <div style={{ color: '#78350f', fontSize: '0.82rem', marginTop: '.2rem' }}>
              This domain is verified, but its MX records still point somewhere else. Every message sent to it
              from outside this platform is being delivered to your old provider, not to Arham.
            </div>
          </div>
          <button onClick={() => setStep(1)} style={{ ...btn(), background: '#dc2626', borderColor: '#dc2626', whiteSpace: 'nowrap' }}>Switch mail here →</button>
        </div>
      )}

      {/* Receiving and sending fail independently. This domain's SES identity sat in
          FAILED for over a week with correct DNS: every outbound message bounced,
          the API already knew, and no screen showed it. Loading this page now
          repairs a failed identity, so the banner also tells the customer to reload. */}
      {domain.verified && domain.sending && !domain.sending.ready && (
        <div style={{ background: 'rgba(220,38,38,.06)', border: '1px solid rgba(220,38,38,.25)', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.9rem' }}>⚠ This domain cannot send mail</div>
          <div style={{ color: '#78350f', fontSize: '0.82rem', marginTop: '.2rem' }}>
            {domain.sending.sandbox
              ? 'Our sending provider is still in sandbox mode, so messages only reach pre-approved recipients. '
                + 'This is a platform-level limit and not something you can fix from here — contact support.'
              : 'Mail sent from this domain is being rejected by the sending provider'
                + (domain.sending.dkimStatus ? ` (DKIM status: ${domain.sending.dkimStatus})` : '')
                + '. Publish the DKIM records below, then reload this page — verification restarts automatically.'}
          </div>
        </div>
      )}

      {/* Step bar */}
      <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', border: '1px solid #dbeafe', marginBottom: '2rem' }}>
        {STEPS.map((s, i) => (
          <div key={s} onClick={() => i < step && setStep(i)}
            style={{ flex: 1, padding: '.75rem 1rem', fontSize: '0.85rem', fontWeight: i === step ? 700 : 500, cursor: i < step ? 'pointer' : 'default', borderRight: i < STEPS.length - 1 ? '1px solid #dbeafe' : 'none', background: i === step ? '#2563eb' : i < step ? '#eff6ff' : '#ffffff', color: i === step ? '#fff' : i < step ? '#16a34a' : '#7fa8d0' }}>
            <span style={{ marginRight: '.4rem', opacity: .8 }}>{i < step ? '✓' : `${i + 1}.`}</span>{s}
          </div>
        ))}
      </div>

      {/* ── Step 0: Verify ── */}
      {step === 0 && (
        domain.verified ? (
          <div style={card()}>
            <p style={{ color: '#16a34a', fontWeight: 600, marginBottom: '.75rem' }}>✓ Domain already verified.</p>
            <button onClick={() => setStep(1)} style={btn()}>Next: Configure DNS →</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={card()}>
              <div style={{ fontWeight: 700, color: '#1e3a5f', marginBottom: '.25rem' }}>
                {detected ? `Verify via ${PROVIDERS[detected]?.label} — one click` : 'Connect your DNS provider to verify instantly'}
              </div>
              <p style={{ color: '#7fa8d0', fontSize: '0.82rem', marginBottom: '1.25rem' }}>
                We'll add the verification TXT record automatically — no copy-pasting.
              </p>
              <ProviderTabs detected={detected} providers={providerList} active={activeProvider} onSwitch={switchProvider} />
              {renderProviderPanel('verify')}
              {verifyResult && <Alert ok={verifyResult.ok} msg={verifyResult.message} />}
            </div>

            <div style={card()}>
              <div style={{ fontWeight: 700, color: '#1e3a5f', marginBottom: '.25rem' }}>Or add the TXT record manually</div>
              <p style={{ color: '#7fa8d0', fontSize: '0.82rem', marginBottom: '1rem' }}>Add this in your DNS provider's dashboard, then click Check.</p>
              {verifyRecord && <DnsRow rec={verifyRecord} idx={0} copiedIdx={copiedIdx} onCopy={copy} />}
              <button onClick={triggerVerify} disabled={verifying} style={{ ...btn(), marginTop: '.5rem', opacity: verifying ? .6 : 1 }}>
                {verifying ? 'Checking DNS…' : 'Check Verification'}
              </button>
            </div>
          </div>
        )
      )}

      {/* ── Step 1: Configure DNS ── */}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={card()}>
            <div style={{ fontWeight: 700, color: '#1e3a5f', marginBottom: '.25rem' }}>
              {detected ? `Add mail DNS records via ${PROVIDERS[detected]?.label}` : 'Add mail DNS records'}
            </div>
            <p style={{ color: '#7fa8d0', fontSize: '0.82rem', marginBottom: '1.25rem' }}>
              MX, SPF, DMARC, and autoconfig — added in one click.
              {(cfToken || doToken || gdToken || (gdKey && gdSecret) || (pbKey && pbSecret)) ? ' Your credentials are already filled in.' : ''}
            </p>
            <ProviderTabs detected={detected} providers={providerList} active={activeProvider} onSwitch={switchProvider} />
            {renderProviderPanel('dns')}
          </div>

          <div style={card()}>
            <div style={{ fontWeight: 700, color: '#1e3a5f', marginBottom: '.25rem' }}>
              {activeProvider && activeProvider !== 'manual' ? 'Or copy records manually' : 'DNS records to add'}
            </div>
            <p style={{ color: '#7fa8d0', fontSize: '0.82rem', marginBottom: '1.25rem' }}>Works with any provider.</p>
            {records.map((r, i) => <DnsRow key={i} rec={r} idx={i + 1} copiedIdx={copiedIdx} onCopy={copy} />)}
          </div>

          <div style={card()}>
            <div style={{ fontWeight: 700, color: '#1e3a5f', marginBottom: '.3rem' }}>DKIM / Outbound signing</div>
            <p style={{ color: '#3b5f8a', fontSize: '0.875rem' }}>Add your domain in <strong style={{ color: '#2563eb' }}>Brevo → Senders &amp; IPs → Domains</strong> for DKIM-signed outbound mail.</p>
          </div>

          <button onClick={() => setStep(2)} style={{ ...btn(), alignSelf: 'flex-start' }}>Mark done &amp; finish →</button>
        </div>
      )}

      {/* ── Step 2: Done ── */}
      {step === 2 && (
        <div style={{ ...card(), textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
          <div style={{ fontWeight: 800, color: '#0f2040', fontSize: '1.3rem', marginBottom: '.5rem' }}>{domain.domain} is ready!</div>
          <p style={{ color: '#3b5f8a', fontSize: '0.9rem', marginBottom: '2rem' }}>Domain verified and DNS configured.</p>
          <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/dashboard/users"     style={{ ...btn(), textDecoration: 'none', display: 'inline-flex' }}>Create email users</a>
            <a href="/dashboard/migration" style={{ ...btn(true), textDecoration: 'none', display: 'inline-flex' }}>Import email</a>
          </div>
        </div>
      )}
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
            style={{ display: 'flex', alignItems: 'center', gap: '.4rem', padding: '.55rem .95rem', borderRadius: 9, border: `2px solid ${isActive ? p.color : isDetected ? `${p.color}55` : '#dbeafe'}`, background: isActive ? `${p.color}12` : isDetected ? `${p.color}06` : '#fff', color: isActive ? p.color : isDetected ? p.color : '#3b5f8a', fontWeight: isActive || isDetected ? 700 : 500, cursor: 'pointer', fontSize: '0.82rem', transition: 'all .15s' }}>
            <span style={{ fontSize: '1rem' }}>{p.logo}</span>
            {p.label}
            {isDetected && !isActive && <span style={{ fontSize: '0.62rem', background: p.color, color: '#fff', padding: '.1rem .3rem', borderRadius: 4, marginLeft: '.2rem' }}>Detected</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ── Popup key connect (GoDaddy / DO / Porkbun) ─────────────────────────── */
/**
 * Credentials are copied out of provider consoles that wrap long values, so a
 * pasted key routinely arrives with an embedded newline or space. Every provider
 * here rejects that as a bad credential, which sends people off re-issuing keys
 * that were fine. None of these tokens legitimately contain whitespace.
 */
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

  // Pulse the hint panel until the popup is open
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
      <button onClick={openPopup}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', padding: '.7rem 1.4rem', background: waiting ? '#166534' : p.color, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', marginBottom: '1rem' }}>
        {p.logo} {waiting ? `${p.label} is open — paste below…` : `Open ${p.label} →`}
      </button>

      {/* Animated step-by-step hint */}
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
              <li key={i} style={{ fontSize: '0.82rem', color: '#1e3a5f', fontWeight: i === portal.steps.length - 1 ? 700 : 400 }}>
                {s}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        {fields.map(f => (
          <input key={f.id} id={f.id} value={f.value} onChange={e => f.onChange(e.target.value)}
            placeholder={f.placeholder} type="password" style={inp()} />
        ))}
      </div>
    </div>
  );
}

/* ── Manual-only panel for unsupported providers ─────────────────────────── */
function ManualPanel({ provider, domain }: { provider: string; domain: string }) {
  const links: Record<string, { label: string; href: string }> = {
    namecheap:   { label: 'Namecheap Advanced DNS',  href: `https://ap.www.namecheap.com/Domains/DomainControlPanel/${domain}/advancedns` },
    route53:     { label: 'AWS Route 53',            href: 'https://console.aws.amazon.com/route53/v2/hostedzones' },
    squarespace: { label: 'Squarespace DNS settings', href: 'https://account.squarespace.com/domains' },
    bluehost:    { label: 'Bluehost Domain Manager', href: 'https://my.bluehost.com/hosting/app#/domains' },
  };
  const link = links[provider];
  // detectDnsProvider can return a provider this map has not caught up with yet;
  // render it generically rather than crashing the whole domain page on undefined.
  const p = PROVIDERS[provider] ?? {
    label: provider.charAt(0).toUpperCase() + provider.slice(1),
    color: '#64748b',
    logo: '📋',
    autoSupport: false,
  };
  return (
    <div style={{ borderTop: '1px solid #dbeafe', paddingTop: '1.25rem' }}>
      <div style={{ background: `${p.color}0d`, border: `1px solid ${p.color}33`, borderRadius: 9, padding: '1rem 1.25rem', marginBottom: '.75rem' }}>
        <div style={{ fontWeight: 700, color: p.color, marginBottom: '.4rem' }}>{p.logo} {p.label}</div>
        <p style={{ color: '#3b5f8a', fontSize: '0.875rem', marginBottom: link ? '.75rem' : 0 }}>
          This provider doesn't offer a public API — add the records below manually in your DNS dashboard.
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

/* ── Zone picker + apply button ─────────────────────────────────────────── */
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
              <div style={{ fontSize: '0.72rem', color: '#3b5f8a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: '.3rem' }}>{zoneLabel}</div>
              <select value={zoneId} onChange={e => onZoneChange(e.target.value)}
                style={{ width: '100%', padding: '.65rem .9rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, color: '#1e3a5f', outline: 'none' }}>
                <option value="">Select…</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </div>
            <button onClick={onApply} disabled={!zoneId || loading}
              style={{ padding: '.65rem 1.25rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.875rem', cursor: zoneId ? 'pointer' : 'not-allowed', opacity: !zoneId || loading ? .6 : 1, whiteSpace: 'nowrap' }}>
              {loading && zones.length > 0 ? 'Working…' : applyLabel}
            </button>
          </>
        )}
      </div>
      {result && (
        <div style={{ marginTop: '1rem', background: result.ok ? 'rgba(22,163,74,.06)' : 'rgba(217,119,6,.06)', border: `1px solid ${result.ok ? 'rgba(22,163,74,.2)' : 'rgba(217,119,6,.2)'}`, borderRadius: 8, padding: '1rem' }}>
          <div style={{ fontWeight: 700, color: result.ok ? '#16a34a' : '#d97706', marginBottom: '.5rem' }}>
            {result.ok ? (applyLabel.includes('verify') ? '✓ Record added! Checking verification…' : '✓ All DNS records added!') : '⚠ Completed with issues'}
          </div>
          {result.results.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: '.5rem', fontSize: '0.78rem', color: isFailed(r.status) ? '#dc2626' : r.status === 'skipped' ? '#d97706' : '#3b5f8a', marginBottom: '.2rem' }}>
              <span>{isFailed(r.status) ? '✗' : r.status === 'skipped' ? 'ℹ' : '✓'}</span>
              <span>{r.record} — <em>{r.error ?? r.status}</em></span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ── DNS record row ──────────────────────────────────────────────────────── */
function DnsRow({ rec, idx, copiedIdx, onCopy }: {
  rec: DnsRecord; idx: number; copiedIdx: number | null; onCopy: (t: string, i: number) => void;
}) {
  const colors: Record<string, string> = { A: '#2563eb', CNAME: '#06b6d4', MX: '#f59e0b', TXT: '#10b981', NS: '#64748b' };
  return (
    <div style={{ background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 8, padding: '1rem', marginBottom: '.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', marginBottom: '.6rem' }}>
        <div style={{ color: '#3b5f8a', fontSize: '0.78rem' }}>{rec.description}</div>
        <button onClick={() => onCopy(`${rec.host}\t${rec.value}`, idx)}
          style={{ padding: '.2rem .65rem', background: copiedIdx === idx ? '#16a34a' : '#2563eb', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700, flexShrink: 0 }}>
          {copiedIdx === idx ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 2fr', gap: '.75rem', alignItems: 'start' }}>
        <span style={{ background: `${colors[rec.type] ?? '#64748b'}22`, color: colors[rec.type] ?? '#3b5f8a', padding: '.2rem .4rem', borderRadius: 5, fontSize: '0.72rem', fontWeight: 700, textAlign: 'center' as const }}>{rec.type}</span>
        <div>
          <div style={{ color: '#7fa8d0', fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase' as const, marginBottom: '.15rem' }}>Host</div>
          <code style={{ color: '#2563eb', fontSize: '0.8rem', wordBreak: 'break-all' as const }}>{rec.host}</code>
          {rec.priority != null && <div style={{ color: '#7fa8d0', fontSize: '0.7rem', marginTop: '.1rem' }}>Priority: {rec.priority}</div>}
        </div>
        <div>
          <div style={{ color: '#7fa8d0', fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase' as const, marginBottom: '.15rem' }}>Value</div>
          <code style={{ color: '#1e3a5f', fontSize: '0.8rem', wordBreak: 'break-all' as const }}>{rec.value}</code>
        </div>
      </div>
    </div>
  );
}

function Alert({ ok, msg }: { ok: boolean; msg: string }) {
  return (
    <div style={{ background: ok ? 'rgba(22,163,74,.08)' : 'rgba(220,38,38,.06)', border: `1px solid ${ok ? 'rgba(22,163,74,.25)' : 'rgba(220,38,38,.2)'}`, borderRadius: 8, padding: '.75rem 1rem', color: ok ? '#16a34a' : '#dc2626', fontSize: '0.875rem', marginTop: '1rem' }}>
      {ok ? '✓ ' : '✗ '}{msg}
    </div>
  );
}

function card(): React.CSSProperties {
  return { background: '#ffffff', border: '1px solid #dbeafe', borderRadius: 12, padding: '1.5rem' };
}
function btn(outline = false): React.CSSProperties {
  return { padding: '.65rem 1.4rem', background: outline ? 'transparent' : '#2563eb', color: outline ? '#2563eb' : '#fff', border: '1.5px solid #2563eb', borderRadius: 8, fontWeight: 700, fontSize: '0.875rem', cursor: 'pointer' };
}
function inp(): React.CSSProperties {
  return { width: '100%', padding: '.65rem .9rem', background: '#f0f6ff', border: '1px solid #bfdbfe', borderRadius: 8, color: '#1e3a5f', outline: 'none', boxSizing: 'border-box' };
}
