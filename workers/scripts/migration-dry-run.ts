/**
 * Read-only report of what migrations 002 and 004 would do to a database.
 *
 * Both perform a destructive dedupe before adding a unique constraint, and both
 * run automatically at worker startup. This tells you what they will touch
 * BEFORE you let a worker near the data. It opens a transaction, inspects, and
 * always rolls back — it cannot modify anything.
 *
 *   MIGRATION_PG_URL=postgresql://... npx tsx scripts/migration-dry-run.ts
 *
 * Run it on the AWS database after migrate-from-do.sh has restored the
 * DigitalOcean data and before starting the workers. On an empty database
 * everything below reports zero, which is the expected result for a fresh stack.
 */
import pg from 'pg';

const url = process.env.MIGRATION_PG_URL;
if (!url) {
  console.error('Set MIGRATION_PG_URL to the database to inspect.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const rows = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;
const has = async (t: string) =>
  (await rows(`SELECT to_regclass($1) AS r`, [`public.${t}`]))[0].r !== null;

let problems = 0;
const warn = (m: string) => { problems++; console.log(`  ⚠  ${m}`); };

await client.connect();
await client.query('BEGIN');
try {
  console.log(`\nInspecting ${url.replace(/:[^:@/]*@/, ':***@')}\n`);

  // ── 002: dedupe migration_users, then add uq_migration_users_job_source ──
  console.log('002  dedupe migration_users');
  if (!await has('migration_users')) {
    console.log('  migration_users does not exist — 002 is a no-op on this database');
  } else {
    const total = (await rows(`SELECT COUNT(*)::int c FROM migration_users`))[0].c;
    const groups = await rows(`
      SELECT migration_job_id, source_email, COUNT(*)::int c
        FROM migration_users GROUP BY 1,2 HAVING COUNT(*) > 1 ORDER BY c DESC`);
    const doomed = groups.reduce((n, g) => n + (g.c - 1), 0);
    console.log(`  ${total} rows, ${groups.length} duplicated (job, source_email) group(s)`);
    if (doomed > 0) {
      warn(`${doomed} row(s) WILL BE DELETED, their counters folded into the keeper`);
      for (const g of groups.slice(0, 10)) {
        const keeper = (await rows(
          `SELECT id, imported_messages, status FROM migration_users
            WHERE migration_job_id = $1 AND source_email = $2
            ORDER BY imported_messages DESC, created_at ASC LIMIT 1`,
          [g.migration_job_id, g.source_email]))[0];
        console.log(`     ${g.source_email}: ${g.c} rows → keeping ${keeper.id}` +
                    ` (${keeper.imported_messages} imported, ${keeper.status})`);
      }
      if (groups.length > 10) console.log(`     … and ${groups.length - 10} more group(s)`);
    }
    // Losing a checkpoint means re-importing that folder from scratch.
    const checkpointLoss = await rows(`
      WITH d AS (
        SELECT migration_job_id, source_email FROM migration_users
         GROUP BY 1,2 HAVING COUNT(*) > 1
      )
      SELECT COUNT(*)::int c FROM migration_users u JOIN d USING (migration_job_id, source_email)
       WHERE u.checkpoint_json <> '{}'::jsonb`);
    if (checkpointLoss[0].c > 1) {
      warn(`${checkpointLoss[0].c} duplicated row(s) carry a checkpoint — only the keeper's ` +
           `survives, so the others' folders re-import from the start`);
    }
  }

  // ── 004: dedupe migration_batches, then add uq_migration_batches_range ──
  console.log('\n004  dedupe migration_batches');
  if (!await has('migration_batches')) {
    console.log('  migration_batches does not exist — 004 is a no-op on this database');
  } else {
    const total = (await rows(`SELECT COUNT(*)::int c FROM migration_batches`))[0].c;
    const groups = await rows(`
      SELECT COUNT(*)::int c FROM (
        SELECT 1 FROM migration_batches
         GROUP BY migration_user_id, folder_key, seq_start, seq_end HAVING COUNT(*) > 1
      ) x`);
    console.log(`  ${total} rows, ${groups[0].c} duplicated range(s)`);
    if (groups[0].c > 0) warn(`${groups[0].c} duplicate range(s) will be collapsed`);

    const drift = await rows(`
      SELECT COUNT(*)::int c FROM migration_users u
       WHERE u.pending_batches <> (
         SELECT COUNT(*) FROM migration_batches b
          WHERE b.migration_user_id = u.id AND b.status = 'pending')`);
    if (drift[0].c > 0) {
      console.log(`  ${drift[0].c} user(s) have a pending_batches counter that 004 will resync`);
    }
  }

  // ── Migration runner state ──
  console.log('\nrunner');
  if (await has('schema_migrations')) {
    const applied = await rows(`SELECT version FROM schema_migrations ORDER BY version`);
    console.log(`  already applied: ${applied.map(a => a.version).join(', ') || '(none)'}`);
  } else {
    console.log('  schema_migrations absent — every migration will be applied in order');
  }

  console.log(problems === 0
    ? '\n✅ Nothing destructive to do. Safe to start the workers.\n'
    : `\n⚠  ${problems} thing(s) above destroy or rewrite data. Take a snapshot first.\n`);
} finally {
  await client.query('ROLLBACK');   // nothing here ever commits
  await client.end();
}
