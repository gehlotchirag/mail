import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { Pool } from 'pg';
import { createDecipheriv } from 'crypto';

/**
 * Sign-in details for the mailboxes a migration created.
 *
 * A migrated account is created with a generated password that previously existed
 * only in a log line, so nobody could tell the user how to sign in — the admin had
 * to reset every mailbox by hand, which does not survive an organisation of forty.
 *
 * Scoped to the caller's own organisation, and only ever returns credentials for
 * accounts THIS migration created. The org admin can already reset any of these
 * passwords from the Users page, so this reveals no privilege they lack; it just
 * saves them destroying and re-issuing a credential that already exists.
 */
let _pool: Pool | null = null;
function getPool() {
  if (!_pool) _pool = new Pool({
    connectionString: process.env.MIGRATION_PG_URL,
    ssl: { rejectUnauthorized: false },
  });
  return _pool;
}

/**
 * Decrypts a stored mailbox password.
 *
 * The worker writes these with `encryptField()`, which returns BASE64 TEXT, and
 * that text is what lands in the BYTEA column — so reading the column gives the
 * ASCII of a base64 string, not the raw `iv|tag|ciphertext` those bytes look like.
 * Decrypting them directly treats the first 12 characters of base64 as the IV and
 * fails every time, which is why every password in the download was unreadable
 * while the mail itself had migrated perfectly.
 *
 * Base64 is tried first because that is what the writer actually produces; the raw
 * path stays for anything written directly as binary.
 */
function decryptField(buf: Buffer): string {
  const key = Buffer.from((process.env.MIGRATION_ENCRYPTION_KEY ?? '').padEnd(32).slice(0, 32));

  const attempt = (payload: Buffer): string => {
    const d = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12));
    d.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([d.update(payload.subarray(28)), d.final()]).toString('utf8');
  };

  const asText = buf.toString('utf8').trim();
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(asText)) {
    try { return attempt(Buffer.from(asText, 'base64')); } catch { /* fall through */ }
  }
  return attempt(buf);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  // workspace_id is checked in the query itself — a job belonging to another
  // organisation must be indistinguishable from one that does not exist.
  const { rows } = await getPool().query(
    `SELECT u.target_email, u.status, u.temp_password_enc
       FROM migration_users u
       JOIN migration_jobs j ON j.id = u.migration_job_id
      WHERE u.migration_job_id = $1 AND j.workspace_id = $2
      ORDER BY u.target_email`,
    [id, session.orgId]
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const users = rows.map((r: { target_email: string; status: string; temp_password_enc: Buffer | null }) => {
    let password: string | null = null;
    if (r.temp_password_enc) {
      try {
        password = decryptField(Buffer.from(r.temp_password_enc));
      } catch (err) {
        console.error(`[migration credentials] could not decrypt for ${r.target_email}:`, err instanceof Error ? err.message : err);
      }
    }
    return {
      email: r.target_email,
      status: r.status,
      // null means the mailbox already existed, so we never set a password for it.
      password,
    };
  });

  const format = new URL(req.url).searchParams.get('format');
  if (format === 'csv') {
    const csv = ['email,password,status',
      ...users.map(u => `${u.email},${u.password ?? ''},${u.status}`)].join('\n');
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="arham-mailboxes-${id.slice(0, 8)}.csv"`,
        // A file full of live credentials must not sit in any shared cache.
        'Cache-Control': 'no-store, private',
      },
    });
  }

  return NextResponse.json({ users }, { headers: { 'Cache-Control': 'no-store, private' } });
}
