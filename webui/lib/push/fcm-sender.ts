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
  // Resolved by the caller (see the JMAP relay route) via the same
  // preview lookup the web service worker uses. Optional so callers that
  // can't resolve them (or don't have any yet) still get a working push —
  // android.notification is simply omitted below.
  title?: string;
  body?: string;
  // Notification tag — same replace-in-place role as sw.js's `tag` for Web
  // Push: a fixed tag collapses repeats into one system-tray entry, a
  // per-email tag (see the JMAP relay route) lets distinct new emails each
  // get their own instead of clobbering each other.
  tag?: string;
}

export async function sendFcmNotification(fcmToken: string, payload: FcmPayload): Promise<void> {
  const messaging = await getMessaging();

  await messaging.send({
    token: fcmToken,
    // Always data-only: read by the Capacitor push listener when the app's
    // JS is actually running (foreground, or backgrounded but not yet
    // killed), which independently fetches /api/push/preview and displays
    // its own LocalNotification. See capacitor-push-registration.tsx.
    data: {
      type: 'email-delivery',
      deviceClientId: payload.deviceClientId,
      accountLabel: payload.accountLabel,
    },
    android: {
      priority: 'high',
      ttl: 60_000,
      // The other half of the delivery story, and the reason title/body get
      // resolved server-side now at all: @capacitor/push-notifications only
      // ever hands a message to JS (confirmed from its own Android source),
      // and JS only runs if Capacitor's Bridge/WebView is alive. Once the
      // app's been backgrounded long enough to be killed, that's not true,
      // and a data-only message just sits unrendered until the app is
      // manually reopened — "only shows when I open the app", reported and
      // reproduced. An android.notification block sidesteps the app (and
      // its JS) entirely: Play Services renders it directly from the FCM
      // payload alone, which works even with the process fully dead.
      //
      // FCM's own semantics make this safe against double-notifying: with a
      // notification block present, Android delivers to onMessageReceived
      // (and so to JS) ONLY while the app is foreground — the case Play
      // Services doesn't auto-render for. Backgrounded/killed, only the
      // auto-render happens; JS doesn't run and can't also show one.
      ...(payload.title && payload.body
        ? {
            notification: {
              title: payload.title,
              body: payload.body,
              tag: payload.tag,
              // Explicit rather than relying solely on AndroidManifest's
              // default_notification_icon/_color meta-data — belt-and-
              // suspenders, and keeps this file self-describing. Without
              // either, Android shows a generic system icon, not the app's:
              // status-bar/notification icons are always rendered as a flat
              // white silhouette cut from the image's alpha channel (Android
              // 5.0+), colored by `color` — never the source file's own
              // colors, regardless of what's set here.
              icon: 'ic_launcher_monochrome',
              color: '#FF6584',
            },
          }
        : {}),
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
