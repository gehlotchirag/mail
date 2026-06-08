import { NextResponse } from 'next/server';
import { removeStaleTokens } from '@/lib/push/cleanup';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/push/mobile/cleanup
 *
 * Removes FCM token records older than 90 days. JMAP PushSubscriptions
 * expire after 90 days so stale tokens can never receive a valid push.
 *
 * Call this periodically from a cron job on the server:
 *   curl -s https://app.arhamworkspace.tech/api/push/mobile/cleanup
 */
export async function GET() {
  try {
    const removed = await removeStaleTokens(90);
    logger.info('Mobile push cleanup completed', { removed });
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    logger.error('Mobile push cleanup failed', { error: (err as Error).message });
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}
