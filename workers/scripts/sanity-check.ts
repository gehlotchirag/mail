// Cheap, dependency-free sanity check for the migration worker plumbing.
// Run with: npm run check
//
// Covers the parts that are easy to get silently wrong and impossible to notice
// until a customer's credentials are already on the wire or their mail has
// quietly gone missing: TLS defaults, the encrypt → Redis payload → decrypt
// round-trip for IMAP credentials, progress/byte accounting, pagination guards,
// migration ordering, and the structural invariants that keep the fan-out from
// checkpointing or completing work that has not actually happened.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const workersDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const readSrc = (rel: string) => readFileSync(join(workersDir, rel), 'utf8');

process.env.MIGRATION_ENCRYPTION_KEY ??= 'sanity-check-key-not-for-production';

const { encryptField, decryptField } = await import('../lib/crypto.js');
const { buildImapTlsOptions, parseAllowInsecureTls } = await import('../lib/imap-tls.js');
const { buildImapCredentials, resolveImapAuth } = await import('../imap/master-user.js');
const { ProgressAccumulator } = await import('../lib/progress.js');
const { PageGuard } = await import('../lib/pagination.js');
const { checkpointOffsetFor, outcomeFor } = await import('../lib/batch-settlement.js');
const { listMigrationFiles } = await import('../db/pool.js');

let checks = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => { checks++; console.log(`  ok  ${name}`); })
    .catch(err => {
      console.error(`  FAIL ${name}: ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    });
}

console.log('[sanity] workers');

await check('TLS verification is on by default', () => {
  assert.equal(buildImapTlsOptions(undefined, 'test').rejectUnauthorized, true);
  assert.equal(buildImapTlsOptions(false, 'test').rejectUnauthorized, true);
});

await check('TLS verification is only bypassed on an explicit opt-in', () => {
  assert.equal(buildImapTlsOptions(true, 'test').rejectUnauthorized, false);
});

await check('allow_insecure_tls only accepts truthy opt-ins', () => {
  assert.equal(parseAllowInsecureTls(true), true);
  assert.equal(parseAllowInsecureTls('true'), true);
  assert.equal(parseAllowInsecureTls(null), false);
  assert.equal(parseAllowInsecureTls(undefined), false);
  assert.equal(parseAllowInsecureTls('no'), false);
  assert.equal(parseAllowInsecureTls(0), false);
});

await check('IMAP credentials survive the encrypted Redis payload round-trip', async () => {
  const creds = { host: 'mail.example.com', masterUser: 'admin', masterPass: 's3cr3t p@ss' };
  const enc = encryptField(JSON.stringify(creds));
  assert.ok(!enc.includes('s3cr3t'), 'plaintext password leaked into the payload');

  const decoded = JSON.parse(decryptField(enc)) as Record<string, string>;
  const built = buildImapCredentials('dovecot', decoded, 'user@example.com');
  const auth = await resolveImapAuth(built);
  assert.equal(built.host, 'mail.example.com');
  assert.equal(auth.user, 'user@example.com*admin');
  assert.equal(auth.pass, 's3cr3t p@ss');
});

await check('encryptField is non-deterministic (fresh IV per call)', () => {
  assert.notEqual(encryptField('same input'), encryptField('same input'));
});

// ── Progress accounting (imported_bytes must never be dropped) ────────────────

await check('every imported byte is flushed, even on an exact flush boundary', async () => {
  const flushed: Array<[number, number]> = [];
  const acc = new ProgressAccumulator(10, async (m, b) => { flushed.push([m, b]); });
  // 50 messages with a flush size of 10: the batch ends exactly on a boundary,
  // which is the case the old `if (progressBatch > 0)` guard dropped entirely.
  for (let i = 0; i < 50; i++) await acc.record(1000);
  await acc.drain();

  const messages = flushed.reduce((n, [m]) => n + m, 0);
  const bytes = flushed.reduce((n, [, b]) => n + b, 0);
  assert.equal(messages, 50, 'message count lost');
  assert.equal(bytes, 50_000, 'imported bytes lost on a flush boundary');
  assert.deepEqual(acc.totals, { messages: 50, bytes: 50_000 });
  assert.ok(flushed.every(([, b]) => b > 0), 'a flush recorded messages but zero bytes');
});

await check('partial flushes carry their bytes too', async () => {
  const flushed: Array<[number, number]> = [];
  const acc = new ProgressAccumulator(10, async (m, b) => { flushed.push([m, b]); });
  for (let i = 0; i < 13; i++) await acc.record(7);
  await acc.drain();
  assert.deepEqual(flushed, [[10, 70], [3, 21]]);
  assert.deepEqual(acc.totals, { messages: 13, bytes: 91 });
});

await check('draining with nothing pending does not write a phantom row', async () => {
  let calls = 0;
  const acc = new ProgressAccumulator(10, async () => { calls++; });
  await acc.drain();
  await acc.drain();
  assert.equal(calls, 0);
});

// ── Pagination guards (C7) ────────────────────────────────────────────────────

await check('pagination stops at the iteration cap', () => {
  const guard = new PageGuard(3, 'test');
  for (let i = 0; i < 3; i++) assert.equal(guard.next(`page-${i}`).ok, true);
  const verdict = guard.next('page-3');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.reason, 'max-pages');
});

await check('pagination stops when the cursor stops advancing', () => {
  const guard = new PageGuard(1000, 'test');
  assert.equal(guard.next('a').ok, true);
  assert.equal(guard.next('b').ok, true);
  const verdict = guard.next('b');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.reason, 'repeated-page');
});

// ── Batch settlement semantics ────────────────────────────────────────────────

await check('a batch only counts as imported when every message is accounted for', () => {
  assert.equal(outcomeFor(50, 50), 'imported');
  assert.equal(outcomeFor(49, 50), 'partial');
  assert.equal(outcomeFor(0, 50), 'partial');
  // Messages deleted at the source count as accounted for — retrying cannot
  // recover them, so they must not park the folder's checkpoint forever.
  assert.equal(outcomeFor(48 + 2, 50), 'imported');
});

await check('checkpoint offsets match how each source resumes', () => {
  // IMAP resumes at lastUid + 1, so it stores the last imported UID.
  assert.equal(checkpointOffsetFor('dovecot'), 0);
  assert.equal(checkpointOffsetFor(undefined), 0);
  // Zoho resumes at the stored list offset, so it stores one past the last index.
  assert.equal(checkpointOffsetFor('zoho'), 1);
});

// ── Schema migrations (C4) ────────────────────────────────────────────────────

await check('migrations are discovered in numeric order with unique versions', () => {
  const files = listMigrationFiles();
  assert.ok(files.length >= 3, `expected at least 3 migrations, found ${files.length}`);
  assert.equal(files[0], '001-initial.sql');
  const numbers = files.map(f => Number(f.match(/^\d+/)![0]));
  assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b), 'migrations are out of order');
  assert.equal(new Set(numbers).size, numbers.length, 'two migrations share a number');
});

await check('001 stays idempotent so an existing production DB can adopt the runner', () => {
  const sql = readSrc('db/migrations/001-initial.sql');
  const creates = sql.match(/CREATE (TABLE|INDEX|UNIQUE INDEX)(?! IF NOT EXISTS)/gi) ?? [];
  assert.deepEqual(creates, [], `001 has non-idempotent DDL: ${creates.join(', ')}`);
  assert.ok(!/ADD COLUMN(?! IF NOT EXISTS)/i.test(sql), '001 has a non-idempotent ADD COLUMN');
});

// ── Structural invariants of the fan-out ──────────────────────────────────────
//
// These are the two regressions that cost mail: a checkpoint written when a batch
// is merely enqueued, and a user completed when its batches are merely enqueued.
// Both are cheap to reintroduce and impossible to spot without a live migration,
// so guard the shape of the code itself.

await check('the enumerator never advances a checkpoint itself', () => {
  const src = readSrc('processors/user-migration.processor.ts');
  assert.ok(
    !/advanceFolderCheckpoint|updateUserCheckpoint/.test(src),
    'user-migration writes a checkpoint at enqueue time — messages in a batch that ' +
    'later exhausts its retries would be skipped silently',
  );
});

await check('the enumerator never completes a user itself', () => {
  const src = readSrc('processors/user-migration.processor.ts');
  assert.ok(
    !/updateUserStatus\([^)]*'completed'/.test(src),
    'user-migration marks the user completed — a user must only complete once its ' +
    'message batches have settled',
  );
  assert.ok(
    src.includes('markUserEnqueueComplete') && src.includes('finishUserIfDone'),
    'user-migration no longer hands completion to the batch accounting',
  );
});

await check('batch settlement is what advances checkpoints and completes users', () => {
  const src = readSrc('lib/batch-settlement.ts');
  assert.ok(src.includes('folderImportWatermark'), 'checkpoints no longer follow the import watermark');
  assert.ok(src.includes('decrementPendingBatches'), 'outstanding batches are no longer tracked');
  assert.ok(src.includes('finishUserIfDone'), 'the last batch no longer completes its user');
});

await check('a permanently failed batch is recorded rather than forgotten', () => {
  const src = readSrc('index.ts');
  assert.ok(
    src.includes('handleBatchFinalFailure') && src.includes('attemptsMade'),
    'no retry-exhausted hook on the message-import worker — a batch that burns its ' +
    'attempts would leave its user stuck and its messages unaccounted for',
  );
});

await check('the reaper demands a liveness signal before reclaiming work', () => {
  const src = readSrc('lib/reaper.ts');
  assert.ok(src.includes('HEARTBEAT_STALE_MS'), 'reaper ignores the heartbeat');
  assert.ok(src.includes('isJobStillLive'), 'reaper does not check BullMQ for a live job');
});

await check('the DigitalOcean Spaces staging module is gone', () => {
  let present = false;
  try { readSrc('lib/spaces.ts'); present = true; } catch { /* expected */ }
  assert.equal(present, false, 'lib/spaces.ts is back — it defaults to a DigitalOcean endpoint');
});

console.log(process.exitCode ? '[sanity] FAILED' : `[sanity] ${checks} checks passed`);
