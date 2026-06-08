import { readFile, writeFile, unlink, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface FcmTokenRecord {
  fcmToken: string;
  username: string;
  serverUrl: string;
  authHeader: string;
  slot: number;
  createdAt: string;
}

function getDir(): string {
  return process.env.PUSH_DATA_DIR ?? path.join(process.cwd(), 'data', 'push-tokens');
}

// Validates that deviceClientId is a 32-char hex string — prevents path traversal.
function safePath(deviceClientId: string): string {
  if (!/^[0-9a-f]{32}$/i.test(deviceClientId)) {
    throw new Error('Invalid deviceClientId format');
  }
  return path.join(getDir(), `${deviceClientId}.json`);
}

async function ensureDir(): Promise<void> {
  const dir = getDir();
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

export async function saveFcmToken(deviceClientId: string, record: FcmTokenRecord): Promise<void> {
  await ensureDir();
  await writeFile(safePath(deviceClientId), JSON.stringify(record, null, 2), 'utf-8');
}

export async function loadFcmToken(deviceClientId: string): Promise<FcmTokenRecord | null> {
  try {
    const raw = await readFile(safePath(deviceClientId), 'utf-8');
    return JSON.parse(raw) as FcmTokenRecord;
  } catch {
    return null;
  }
}

export async function deleteFcmToken(deviceClientId: string): Promise<void> {
  try {
    await unlink(safePath(deviceClientId));
  } catch {
    // noop — already gone
  }
}

export async function listFcmTokens(): Promise<{ deviceClientId: string; record: FcmTokenRecord }[]> {
  await ensureDir();
  const dir = getDir();
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const results: { deviceClientId: string; record: FcmTokenRecord }[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const deviceClientId = file.slice(0, -5);
    if (!/^[0-9a-f]{32}$/i.test(deviceClientId)) continue;
    try {
      const raw = await readFile(path.join(dir, file), 'utf-8');
      results.push({ deviceClientId, record: JSON.parse(raw) as FcmTokenRecord });
    } catch {
      // skip corrupted files
    }
  }
  return results;
}

export async function getTokenFileStat(deviceClientId: string): Promise<{ mtimeMs: number } | null> {
  try {
    const s = await stat(safePath(deviceClientId));
    return { mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}
