import pg from 'pg';
import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Pool } = pg;

// Lazy-initialized pool so env vars (loaded by dotenv) are available at first use
let _pool: InstanceType<typeof Pool> | null = null;

function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.MIGRATION_PG_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    });
    _pool.on('error', err => console.error('[db] Pool error:', err));
  }
  return _pool;
}

// Proxy object so callers can still do `pool.query(...)` directly
const pool = new Proxy({} as InstanceType<typeof Pool>, {
  get(_target, prop) {
    const p = getPool();
    const val = (p as unknown as Record<string | symbol, unknown>)[prop];
    return typeof val === 'function' ? val.bind(p) : val;
  },
});

export default pool;

const __dir = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dir, 'migrations');

// Every worker boots by running migrations, so several processes can race on the
// same database. A session-level advisory lock serialises them: the first worker
// applies, the rest block and then find everything already recorded.
const MIGRATION_LOCK_KEY = 8_246_119_045_731_002n;

/** Ordered list of migration files: `NNN-name.sql`, applied lowest first. */
export function listMigrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter(f => /^\d+.*\.sql$/.test(f))
    .sort((a, b) => {
      const na = Number(a.match(/^\d+/)![0]);
      const nb = Number(b.match(/^\d+/)![0]);
      return na === nb ? a.localeCompare(b) : na - nb;
    });
}

/**
 * Dependency-free migration runner.
 *
 * Each file is applied exactly once, inside its own transaction, and recorded in
 * `schema_migrations`. Safe against the existing production database: 001 is
 * written entirely with IF NOT EXISTS, so the first run after this change simply
 * re-executes it as a no-op and records it as applied.
 */
export async function runMigrations(): Promise<string[]> {
  const client = await getPool().connect();
  const applied: string[] = [];
  let locked = false;
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    );

    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY.toString()]);
    locked = true;

    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const done = new Set(rows.map(r => r.version as string));

    for (const file of listMigrationFiles()) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => { /* connection may be gone */ });
        throw new Error(
          `[db] Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      applied.push(file);
      console.log(`[db] Applied migration ${file}`);
    }

    console.log(
      applied.length
        ? `[db] Migrations applied (${applied.length} new)`
        : '[db] Migrations up to date',
    );
    return applied;
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY.toString()])
        .catch(() => { /* releasing on a dead connection is moot */ });
    }
    client.release();
  }
}
