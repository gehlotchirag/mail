// Cheap, dependency-free sanity check for the migration worker plumbing.
// Run with: npm run check
//
// Covers the parts that are easy to get silently wrong and impossible to notice
// until a customer's credentials are already on the wire: TLS defaults, and the
// encrypt → Redis payload → decrypt round-trip for IMAP credentials.

import assert from 'node:assert/strict';

process.env.MIGRATION_ENCRYPTION_KEY ??= 'sanity-check-key-not-for-production';

const { encryptField, decryptField } = await import('../lib/crypto.js');
const { buildImapTlsOptions, parseAllowInsecureTls } = await import('../lib/imap-tls.js');
const { buildImapCredentials, resolveImapAuth } = await import('../imap/master-user.js');

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

console.log(process.exitCode ? '[sanity] FAILED' : `[sanity] ${checks} checks passed`);
