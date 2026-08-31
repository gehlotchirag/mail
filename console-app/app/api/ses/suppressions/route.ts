import { NextResponse } from 'next/server';
import { query, ensureDb } from '@/lib/db';
import { getSession } from '@/lib/auth';

interface SuppressionRow {
  email: string;
  reason: string;
  sub_type: string | null;
  suppressed: boolean;
  diagnostic: string | null;
  source: string | null;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
}

/**
 * The suppression list recorded from SES bounce and complaint notifications.
 *
 * Every query is scoped to the caller's org. The addresses a tenant's mail
 * bounced off — and the diagnostics SES returns with them — are that tenant's
 * data, not the platform's.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureDb();
  const url = new URL(req.url);
  const search = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 500);

  const rows = search
    ? await query<SuppressionRow>(
        `SELECT email, reason, sub_type, suppressed, diagnostic, source, occurrences,
                first_seen_at, last_seen_at
         FROM email_suppressions
         WHERE org_id = $1 AND email LIKE '%' || $2 || '%'
         ORDER BY last_seen_at DESC LIMIT $3`,
        [session.orgId, search, limit]
      )
    : await query<SuppressionRow>(
        `SELECT email, reason, sub_type, suppressed, diagnostic, source, occurrences,
                first_seen_at, last_seen_at
         FROM email_suppressions
         WHERE org_id = $1
         ORDER BY last_seen_at DESC LIMIT $2`,
        [session.orgId, limit]
      );

  return NextResponse.json({ suppressions: rows });
}

/**
 * Removes an address from the suppression list — for the case where a customer
 * has fixed a mailbox that was hard-bouncing. Deliberately a delete rather than
 * a flag flip, so a later bounce starts the record over.
 */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const email = new URL(req.url).searchParams.get('email')?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });

  await ensureDb();
  const removed = await query<{ email: string }>(
    'DELETE FROM email_suppressions WHERE org_id = $1 AND email = $2 RETURNING email',
    [session.orgId, email]
  );
  if (!removed.length) return NextResponse.json({ error: 'Not suppressed' }, { status: 404 });

  console.log(`[ses] ${session.email} removed ${email} from the suppression list`);
  return NextResponse.json({ ok: true, email });
}
