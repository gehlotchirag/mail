import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';
import { saveFcmToken, loadFcmToken, deleteFcmToken } from '@/lib/push/fcm-store';
import { pollJmapVerificationCode } from '@/lib/push/relay-helpers';
import { createConnectedJmapClient } from '@/lib/push/jmap-server-client';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUBSCRIPTION_EXPIRES_DAYS = 90;

function expiresFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function getAppBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) throw new Error('NEXT_PUBLIC_APP_URL is not set');
  return url.replace(/\/+$/, '');
}

/**
 * POST /api/push/mobile/register
 *
 * Called by the Capacitor app after the user is authenticated and FCM
 * registration completes. Creates a JMAP PushSubscription pointing back
 * to our relay route so Stalwart can deliver state-change events.
 *
 * Body: { fcmToken: string; deviceClientId?: string }
 *   - If deviceClientId is provided and belongs to this user, only the
 *     FCM token is updated (handles token rotation). No new JMAP sub needed.
 *   - If absent, a fresh subscription is created.
 */
export async function POST(request: NextRequest) {
  const creds = await getStalwartCredentials(request);
  if (!creds) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { fcmToken?: string; deviceClientId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { fcmToken, deviceClientId: existingDeviceClientId } = body;
  if (!fcmToken || typeof fcmToken !== 'string') {
    return NextResponse.json({ error: 'fcmToken is required' }, { status: 400 });
  }

  // --- Token rotation: existing device, just update the FCM token ---
  if (existingDeviceClientId && /^[0-9a-f]{32}$/i.test(existingDeviceClientId)) {
    const existing = await loadFcmToken(existingDeviceClientId);
    if (existing && existing.username === creds.username) {
      await saveFcmToken(existingDeviceClientId, {
        ...existing,
        fcmToken,
        // Update authHeader in case the session was refreshed
        authHeader: creds.authHeader,
      });
      logger.info('Mobile push token updated (rotation)', {
        username: creds.username,
        deviceClientId: existingDeviceClientId,
      });
      return NextResponse.json({ ok: true, deviceClientId: existingDeviceClientId });
    }
  }

  // --- New registration ---
  const deviceClientId = crypto.randomBytes(16).toString('hex');
  const appBase = getAppBaseUrl();
  const relayUrl = `${appBase}/api/push/mobile/jmap/${deviceClientId}`;

  // Persist the token record before creating the JMAP subscription so that
  // a crash during verification doesn't leave a dangling sub with no token.
  await saveFcmToken(deviceClientId, {
    fcmToken,
    username: creds.username,
    serverUrl: creds.serverUrl,
    authHeader: creds.authHeader,
    slot: creds.slot,
    createdAt: new Date().toISOString(),
  });

  try {
    const client = await createConnectedJmapClient(creds);

    // Reap stale mobile subscriptions for this user to avoid accumulation.
    try {
      const existing = await client.listPushSubscriptions();
      const stale = existing.filter((s) =>
        s.url.startsWith(`${appBase}/api/push/mobile/jmap/`)
      );
      for (const s of stale) {
        await client.destroyPushSubscription(s.id).catch(() => undefined);
        const oldId = s.url.split('/').pop() ?? '';
        if (/^[0-9a-f]{32}$/i.test(oldId)) {
          await deleteFcmToken(oldId).catch(() => undefined);
        }
      }
    } catch {
      // Non-fatal: stale subs will expire on their own
    }

    const serverId = await client.createPushSubscription({
      deviceClientId,
      url: relayUrl,
      types: ['EmailDelivery'],
      expires: expiresFromNow(SUBSCRIPTION_EXPIRES_DAYS),
    });

    // Wait for Stalwart to POST the PushVerification to our relay route
    const verificationCode = await pollJmapVerificationCode(deviceClientId);
    await client.verifyPushSubscription(serverId, verificationCode);

    logger.info('Mobile push registered', { username: creds.username, deviceClientId });
    return NextResponse.json({ ok: true, deviceClientId });
  } catch (err) {
    // Clean up the token file if subscription setup failed
    await deleteFcmToken(deviceClientId).catch(() => undefined);
    logger.error('Mobile push registration failed', {
      username: creds.username,
      error: (err as Error).message,
    });
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 });
  }
}

/**
 * DELETE /api/push/mobile/register?deviceClientId=...
 *
 * Deregisters a device: destroys the JMAP subscription and removes the token.
 * Called on app logout or when the user disables notifications.
 */
export async function DELETE(request: NextRequest) {
  const creds = await getStalwartCredentials(request);
  if (!creds) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const deviceClientId = request.nextUrl.searchParams.get('deviceClientId') ?? '';
  if (!/^[0-9a-f]{32}$/i.test(deviceClientId)) {
    return NextResponse.json({ error: 'Invalid deviceClientId' }, { status: 400 });
  }

  const record = await loadFcmToken(deviceClientId);
  if (!record || record.username !== creds.username) {
    // Not found or belongs to a different user — treat as success
    return NextResponse.json({ ok: true });
  }

  try {
    const client = await createConnectedJmapClient(creds);
    const subs = await client.listPushSubscriptions();
    const appBase = getAppBaseUrl();
    const match = subs.find((s) => s.url === `${appBase}/api/push/mobile/jmap/${deviceClientId}`);
    if (match) await client.destroyPushSubscription(match.id).catch(() => undefined);
  } catch {
    // Non-fatal — token file removal below is what matters
  }

  await deleteFcmToken(deviceClientId);
  logger.info('Mobile push deregistered', { username: creds.username, deviceClientId });
  return NextResponse.json({ ok: true });
}
