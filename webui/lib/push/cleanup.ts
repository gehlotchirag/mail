import { listFcmTokens, deleteFcmToken, getTokenFileStat } from '@/lib/push/fcm-store';

/**
 * Remove FCM token records older than maxAgeDays.
 * JMAP PushSubscriptions expire after 90 days (set in register/route.ts),
 * so tokens beyond that age can never receive a valid push anyway.
 *
 * Returns the number of records deleted.
 */
export async function removeStaleTokens(maxAgeDays = 90): Promise<number> {
  const tokens = await listFcmTokens();
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  let removed = 0;

  for (const { deviceClientId, record } of tokens) {
    const createdAt = new Date(record.createdAt).getTime();
    // Fall back to file mtime if createdAt is missing/invalid
    const fileStat = isNaN(createdAt) ? await getTokenFileStat(deviceClientId) : null;
    const age = fileStat ? fileStat.mtimeMs : createdAt;

    if (age < cutoff) {
      await deleteFcmToken(deviceClientId);
      removed++;
    }
  }

  return removed;
}
