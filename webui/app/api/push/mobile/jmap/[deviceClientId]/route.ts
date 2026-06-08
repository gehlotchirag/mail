import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { storeVerificationCode } from '@/lib/push/relay-helpers';
import { loadFcmToken } from '@/lib/push/fcm-store';
import { sendFcmNotification } from '@/lib/push/fcm-sender';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface JmapPushPayload {
  '@type': 'PushVerification' | 'StateChange' | string;
  pushSubscriptionId?: string;
  verificationCode?: string;
  changed?: Record<string, Record<string, string>>;
}

/**
 * POST /api/push/mobile/jmap/[deviceClientId]
 *
 * JMAP server callback endpoint (RFC 8620 §7.3). Stalwart POSTs here when:
 *   1. A PushSubscription is first created (PushVerification)
 *   2. A state change occurs (StateChange — e.g. new email)
 *
 * The URL itself acts as a 256-bit shared secret (32 random hex bytes).
 * No additional auth header is required or expected from Stalwart.
 *
 * IMPORTANT: Always return 200. A non-200 response causes Stalwart to retry,
 * which would result in duplicate notifications.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deviceClientId: string }> },
) {
  const { deviceClientId } = await params;

  // Validate the deviceClientId format — log probing attempts
  if (!/^[0-9a-f]{32}$/i.test(deviceClientId)) {
    logger.warn('JMAP relay: invalid deviceClientId in URL', { deviceClientId });
    return NextResponse.json({ ok: true });
  }

  let payload: JmapPushPayload;
  try {
    payload = await request.json() as JmapPushPayload;
  } catch {
    logger.warn('JMAP relay: unparseable body', { deviceClientId });
    return NextResponse.json({ ok: true });
  }

  logger.info('JMAP relay: received', { deviceClientId, type: payload['@type'] });

  if (payload['@type'] === 'PushVerification') {
    if (payload.verificationCode) {
      await storeVerificationCode(deviceClientId, payload.verificationCode);
      logger.info('JMAP relay: stored verification code', { deviceClientId });
    }
    return NextResponse.json({ ok: true });
  }

  if (payload['@type'] === 'StateChange') {
    const record = await loadFcmToken(deviceClientId);
    if (!record) {
      // Unknown device — may have been deregistered. Log but don't error.
      logger.warn('JMAP relay: StateChange for unknown device', { deviceClientId });
      return NextResponse.json({ ok: true });
    }

    try {
      await sendFcmNotification(record.fcmToken, {
        deviceClientId,
        accountLabel: record.username,
      });
      logger.info('FCM push sent', { username: record.username, deviceClientId });
    } catch (err) {
      logger.error('FCM push failed', {
        username: record.username,
        deviceClientId,
        error: (err as Error).message,
      });
      // Still return 200 — FCM failure should not trigger Stalwart retries
    }
  }

  return NextResponse.json({ ok: true });
}
