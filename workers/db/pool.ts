import pg from 'pg';
import { readFileSync } from 'fs';
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

export async function runMigrations() {
  const sql = readFileSync(join(__dir, 'migrations/001-initial.sql'), 'utf8');
  await getPool().query(sql);
  console.log('[db] Migrations applied');
}
