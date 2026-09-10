"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { Preferences } from "@capacitor/preferences";

// Registers native push (FCM) with the relay, for the Capacitor shell only.
//
// This has to live here rather than in mobile/src/index.ts: capacitor.config.ts
// runs the app in remote-URL mode (`server.url`), so the WebView navigates
// straight to this webui and mobile/www's bundled JS never executes. Without
// this component, PushNotifications.register() is never called on either
// platform and mobile push silently never starts — the relay routes at
// app/api/push/mobile/* have nothing calling them. See mobile/README.md.
//
// isNativePlatform() is false in every ordinary browser tab, so this is a
// no-op outside the Capacitor shell — importing @capacitor/core and
// @capacitor/push-notifications does not pull in any native code on web,
// they're pure-JS shims there.

const DEVICE_ID_KEY = "pushDeviceClientId";

async function getStoredDeviceClientId(): Promise<string | null> {
  const { value } = await Preferences.get({ key: DEVICE_ID_KEY });
  return value ?? null;
}

async function saveDeviceClientId(id: string): Promise<void> {
  await Preferences.set({ key: DEVICE_ID_KEY, value: id });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Register the FCM token with the relay. Retries indefinitely with backoff:
 * - 401 means the user isn't logged in yet (the request carries the session
 *   cookie automatically) — keep retrying until they are.
 * - Any other failure (relay hiccup, network blip) also retries; there's no
 *   user-facing surface to report failure to from here.
 */
async function registerWithServer(fcmToken: string, signal: AbortSignal): Promise<void> {
  const existingDeviceClientId = await getStoredDeviceClientId();
  let delay = 2000;

  while (!signal.aborted) {
    try {
      const res = await fetch("/api/push/mobile/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fcmToken, deviceClientId: existingDeviceClientId }),
        signal,
      });

      if (res.status === 401) {
        await sleep(delay);
        delay = Math.min(Math.floor(delay * 1.5), 30_000);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = (await res.json()) as { deviceClientId?: string };
      if (data.deviceClientId) {
        await saveDeviceClientId(data.deviceClientId);
      }
      return;
    } catch (err) {
      if (signal.aborted) return;
      console.warn("[Push] Registration attempt failed, retrying...", err);
      await sleep(delay);
      delay = Math.min(Math.floor(delay * 1.5), 30_000);
    }
  }
}

export function CapacitorPushRegistration() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const controller = new AbortController();
    let registrationListener: { remove: () => void } | undefined;
    let errorListener: { remove: () => void } | undefined;
    let tapListener: { remove: () => void } | undefined;

    (async () => {
      // Android 13+ (targetSdk 33+) requires this explicit runtime check; iOS
      // and older Android fold it into requestPermissions() below regardless.
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== "granted") {
        console.warn("[Push] Permission denied");
        return;
      }

      registrationListener = await PushNotifications.addListener(
        "registration",
        ({ value: fcmToken }) => {
          void registerWithServer(fcmToken, controller.signal);
        },
      );
      errorListener = await PushNotifications.addListener("registrationError", (err) => {
        console.error("[Push] Registration error:", err);
      });

      // Deep-linking a tapped notification straight to the email it's for needs
      // a route that reads it (e.g. a `?email=` param page.tsx picks up) — that
      // doesn't exist yet, so this only logs for now rather than navigating
      // somewhere broken. The WebView is already this app, so a background tap
      // just foregrounds it as-is in the meantime.
      tapListener = await PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (action) => {
          console.log("[Push] Notification tapped:", action.notification.data);
        },
      );

      await PushNotifications.register();
    })();

    return () => {
      controller.abort();
      registrationListener?.remove();
      errorListener?.remove();
      tapListener?.remove();
    };
  }, []);

  return null;
}
