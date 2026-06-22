import { createDecipheriv } from 'crypto';

function encryptionKey(): Buffer {
  const raw = process.env.MIGRATION_ENCRYPTION_KEY ?? process.env.SESSION_SECRET ?? '';
  return Buffer.from(raw.padEnd(32).slice(0, 32));
}

export function decryptCredentials(buf: Buffer): Record<string, string> {
  const key = encryptionKey();
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(decipher.update(enc).toString('utf8') + decipher.final('utf8'));
}
