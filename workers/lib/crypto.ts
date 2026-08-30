import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

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

export function encryptField(plaintext: string): string {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptField(encrypted: string): string {
  const key = encryptionKey();
  const buf = Buffer.from(encrypted, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString('utf8') + decipher.final('utf8');
}
