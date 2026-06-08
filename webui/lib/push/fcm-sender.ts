// Firebase Admin SDK is loaded lazily (dynamic import) so it is never bundled
// by Next.js. It must be listed in next.config.ts serverExternalPackages.

let messagingInstance: import('firebase-admin/messaging').Messaging | null = null;

async function getMessaging(): Promise<import('firebase-admin/messaging').Messaging> {
  if (messagingInstance) return messagingInstance;

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!serviceAccountPath) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH env var is not set');
  }

  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getMessaging } = await import('firebase-admin/messaging');
  const { readFileSync } = await import('node:fs');

  if (!getApps().length) {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));
    initializeApp({ credential: cert(serviceAccount) });
  }

  messagingInstance = getMessaging();
  return messagingInstance;
}

export interface FcmPayload {
  deviceClientId: string;
  accountLabel: string;
}

export async function sendFcmNotification(fcmToken: string, payload: FcmPayload): Promise<void> {
  const messaging = await getMessaging();

  await messaging.send({
    token: fcmToken,
    // Data-only message — the Capacitor push listener fetches /api/push/preview
    // for the rich notification content (sender, subject, preview).
    data: {
      type: 'email-delivery',
      deviceClientId: payload.deviceClientId,
      accountLabel: payload.accountLabel,
    },
    android: {
      priority: 'high',
      ttl: 60_000,
    },
    apns: {
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'background',
      },
      payload: {
        aps: {
          'content-available': 1,
        },
      },
    },
  });
}
