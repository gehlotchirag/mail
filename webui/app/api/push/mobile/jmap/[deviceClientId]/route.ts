import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { storeVerificationCode } from '@/lib/push/relay-helpers';
import { loadFcmToken } from '@/lib/push/fcm-store';
import { sendFcmNotification } from '@/lib/push/fcm-sender';
import { fetchPushPreview } from '@/lib/push/preview';

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
      // @capacitor/push-notifications only forwards a data-only FCM message
      // to JS — it never shows anything itself (confirmed from its Android
      // MessagingService source). JS only runs at all if Capacitor's Bridge
      // and WebView are alive; when the app has been backgrounded long
      // enough to be killed (or swiped away), the plugin just stashes the
      // message in a static field and replays it next time the app opens —
      // which is exactly "notification only shows when I open the app".
      // Resolving the content here and adding it as an Android `notification`
      // block (see fcm-sender.ts) lets Play Services display it directly,
      // with no app code — including a fully killed app — running at all.
      //
      // Best-effort: if the lookup fails, fall back to a generic "New mail"
      // rather than drop the notification outright — same trade sw.js makes
      // for the same reason (offline, session expired, server hiccup).
      let title = `New mail (${record.username})`;
      let body = 'You have new mail';
      let tag = 'bulwark-mail';
      try {
        const preview = await fetchPushPreview({
          serverUrl: record.serverUrl,
          authHeader: record.authHeader,
        });
        if (!preview.email && preview.unreadTotal === 0) {
          // Genuinely nothing new — a straggler from a stale subscription or
          // a read race. Skip the send instead of an empty-handed "New mail".
          logger.info('JMAP relay: preview found nothing new, skipping send', {
            deviceClientId,
          });
          return NextResponse.json({ ok: true });
        }
        if (preview.email) {
          const sender = preview.email.from?.[0];
          title = sender?.name || sender?.email || 'New mail';
          body = preview.email.subject || preview.email.preview || '(no subject)';
          tag = 'bulwark-mail:' + preview.email.id;
        } else {
          body = preview.unreadTotal > 1
            ? `${preview.unreadTotal} unread messages`
            : 'You have new mail';
        }
      } catch (previewErr) {
        logger.warn('JMAP relay: preview lookup failed, using generic notification', {
          deviceClientId,
          error: (previewErr as Error).message,
        });
      }

      await sendFcmNotification(record.fcmToken, {
        deviceClientId,
        accountLabel: record.username,
        title,
        body,
        tag,
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
