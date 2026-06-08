import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Verification codes are written to temp files so they survive PM2 restarts
// and are safe under single-process deployments. File name format:
// data/push-tokens/.verify-{deviceClientId}

function getDir(): string {
  return process.env.PUSH_DATA_DIR ?? path.join(process.cwd(), 'data', 'push-tokens');
}

function verifyPath(deviceClientId: string): string {
  if (!/^[0-9a-f]{32}$/i.test(deviceClientId)) {
    throw new Error('Invalid deviceClientId format');
  }
  return path.join(getDir(), `.verify-${deviceClientId}`);
}

async function ensureDir(): Promise<void> {
  const dir = getDir();
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

export async function storeVerificationCode(deviceClientId: string, code: string): Promise<void> {
  await ensureDir();
  await writeFile(verifyPath(deviceClientId), code, 'utf-8');
}

export async function pollJmapVerificationCode(
  deviceClientId: string,
  timeoutMs = 75_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let delay = 400;

  while (Date.now() < deadline) {
    try {
      const code = await readFile(verifyPath(deviceClientId), 'utf-8');
      if (code.trim()) {
        // Delete after reading so stale codes don't linger
        await unlink(verifyPath(deviceClientId)).catch(() => undefined);
        return code.trim();
      }
    } catch {
      // file not yet written — keep polling
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.floor(delay * 1.5), 2000);
  }

  // Clean up stale verify file if it somehow exists but never had a valid code
  await unlink(verifyPath(deviceClientId)).catch(() => undefined);
  throw new Error(`Timed out waiting for JMAP PushVerification for ${deviceClientId}`);
}
