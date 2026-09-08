import { Pool } from 'pg';

/**
 * Connection to the migration database, shared by the modules that persist run
 * state. Separate from `@/lib/db` (the console database) because `migration_jobs`,
 * `imap_runs` and the discovery cache all live alongside each other in the
 * migration database — pointing at the wrong one is a mistake this codebase has
 * already made once, with `relation "domains" does not exist`.
 */
let pool: Pool | null = null;

export function runPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.MIGRATION_PG_URL ?? process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}
