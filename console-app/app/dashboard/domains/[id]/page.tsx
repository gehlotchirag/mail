import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { getRequiredDnsRecords, getVerifyRecord } from '@/lib/dns';

export default async function DomainDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const { id } = await params;

  const domain = await queryOne<{ id: string; domain: string; verified: boolean; verify_token: string }>(
    'SELECT * FROM domains WHERE id = $1 AND org_id = $2', [id, session.orgId]
  );
  if (!domain) redirect('/dashboard/domains');

  const records = getRequiredDnsRecords(domain.domain);
  const verifyRecord = getVerifyRecord(domain.domain, domain.verify_token);

  const typeColor: Record<string, string> = { A: '#6366f1', CNAME: '#06b6d4', MX: '#f59e0b', TXT: '#10b981', NS: '#64748b' };

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ marginBottom: '2rem' }}>
        <a href="/dashboard/domains" style={{ color: '#64748b', fontSize: '0.85rem' }}>← Back to domains</a>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '.75rem', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.5px' }}>{domain.domain}</h1>
          <span style={{ fontSize: '0.75rem', padding: '.25rem .65rem', borderRadius: 6, background: domain.verified ? 'rgba(34,197,94,.12)' : 'rgba(251,191,36,.12)', color: domain.verified ? '#4ade80' : '#fbbf24', fontWeight: 700 }}>
            {domain.verified ? '✓ Verified' : '⏳ Pending verification'}
          </span>
        </div>
      </div>

      {!domain.verified && (
        <div style={{ background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.25)', borderRadius: 10, padding: '1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ fontWeight: 600, color: '#a5b4fc', marginBottom: '.5rem' }}>Step 1 — Verify domain ownership</div>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Add this TXT record to your DNS provider to prove you own this domain, then click Verify on the Domains page.</p>
          <DnsRecordRow record={verifyRecord} typeColor={typeColor} />
        </div>
      )}

      <div style={{ background: '#161b27', border: '1px solid #1e2535', borderRadius: 12, padding: '1.5rem' }}>
        <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: '1rem', marginBottom: '.5rem' }}>
          {domain.verified ? 'Required DNS Records' : 'Step 2 — Configure email DNS'}
        </div>
        <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
          Add these records to your DNS provider ({domain.domain.split('.').slice(-2).join('.')}&apos;s registrar or Cloudflare, etc.). Changes can take up to 48 hours.
        </p>

        {records.map((r, i) => <DnsRecordRow key={i} record={r} typeColor={typeColor} />)}
      </div>

      <div style={{ background: '#161b27', border: '1px solid #1e2535', borderRadius: 12, padding: '1.5rem', marginTop: '1rem' }}>
        <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: '1rem', marginBottom: '.5rem' }}>ℹ️ Outbound email (DKIM)</div>
        <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
          Outbound mail is sent via Brevo. To authenticate your domain with Brevo for DKIM signing, log in to your Brevo account and add your domain under <strong style={{ color: '#94a3b8' }}>Senders &amp; IPs → Domains</strong>. Brevo will provide CNAME records to add.
        </p>
      </div>
    </div>
  );
}

function DnsRecordRow({ record, typeColor }: { record: { type: string; host: string; value: string; priority?: number; description: string }; typeColor: Record<string, string> }) {
  return (
    <div style={{ background: '#0f1117', border: '1px solid #2d3448', borderRadius: 8, padding: '1rem', marginBottom: '.75rem' }}>
      <div style={{ color: '#64748b', fontSize: '0.78rem', marginBottom: '.75rem' }}>{record.description}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr', gap: '.75rem', alignItems: 'start' }}>
        <span style={{ background: `${typeColor[record.type] ?? '#64748b'}22`, color: typeColor[record.type] ?? '#94a3b8', padding: '.2rem .5rem', borderRadius: 5, fontSize: '0.72rem', fontWeight: 700, textAlign: 'center' as const }}>{record.type}</span>
        <div>
          <div style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase' as const, marginBottom: '.2rem' }}>Host</div>
          <code style={{ color: '#93c5fd', fontSize: '0.82rem', wordBreak: 'break-all' as const }}>{record.host}</code>
          {record.priority != null && <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '.2rem' }}>Priority: {record.priority}</div>}
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase' as const, marginBottom: '.2rem' }}>Value</div>
          <code style={{ color: '#e2e8f0', fontSize: '0.82rem', wordBreak: 'break-all' as const }}>{record.value}</code>
        </div>
      </div>
    </div>
  );
}
