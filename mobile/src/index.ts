import { PushNotifications } from '@capacitor/push-notifications';
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

const SERVER = 'https://app.arhamworkspace.tech';
const DEVICE_ID_KEY = 'pushDeviceClientId';

async function getStoredDeviceClientId(): Promise<string | null> {
  const { value } = await Preferences.get({ key: DEVICE_ID_KEY });
  return value ?? null;
}

async function saveDeviceClientId(id: string): Promise<void> {
  await Preferences.set({ key: DEVICE_ID_KEY, value: id });
}

/**
 * Register FCM token with the server. Retries indefinitely with backoff.
 * - Returns 401 when user isn't logged in yet → keeps retrying until they log in.
 * - On success → saves deviceClientId locally for token rotation handling.
 */
async function registerWithServer(fcmToken: string): Promise<void> {
  const existingDeviceClientId = await getStoredDeviceClientId();
  let delay = 2000;

  while (true) {
    try {
      const res = await fetch(`${SERVER}/api/push/mobile/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Session cookie is sent automatically — this is what authenticates
        // the request. Registration only succeeds after the user logs in.
        credentials: 'include',
        body: JSON.stringify({ fcmToken, deviceClientId: existingDeviceClientId }),
      });

      if (res.status === 401) {
        // User not logged in yet — retry after delay
        await sleep(delay);
        delay = Math.min(Math.floor(delay * 1.5), 30_000);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json() as { deviceClientId?: string };
      if (data.deviceClientId) {
        await saveDeviceClientId(data.deviceClientId);
      }
      console.log('[Push] Registration complete:', data.deviceClientId);
      return;
    } catch (err) {
      console.warn('[Push] Registration attempt failed, retrying...', err);
      await sleep(delay);
      delay = Math.min(Math.floor(delay * 1.5), 30_000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Initialise native push notifications.
 * Call this once on app start — it is a no-op in the browser.
 *
 * Android 13+: requestPermissions() shows the OS permission dialog.
 * Call this after the user has seen value from the app (not on cold launch).
 */
export async function initPush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') {
    console.warn('[Push] Permission denied');
    return;
  }

  await PushNotifications.register();

  // Fires on initial registration and whenever FCM rotates the token
  PushNotifications.addListener('registration', ({ value: fcmToken }) => {
    console.log('[Push] FCM token received, registering with server...');
    void registerWithServer(fcmToken);
  });

  PushNotifications.addListener('registrationError', (err) => {
    console.error('[Push] Registration error:', err);
  });

  // Foreground push received — Capacitor will show it per presentationOptions
  PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.log('[Push] Notification received in foreground:', notification);
  });

  // User tapped the notification → navigate the WebView to the email
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const data = action.notification.data as Record<string, string> | undefined;
    const emailId = data?.emailId;
    const url = emailId
      ? `${SERVER}/en?email=${encodeURIComponent(emailId)}`
      : `${SERVER}/`;
    // The WebView is already displaying the server URL; update the location
    window.location.href = url;
  });
}

// Auto-initialise when the script loads (Capacitor injects this into the WebView)
void initPush();
