"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications, type PushNotificationSchema } from "@capacitor/push-notifications";
import { Preferences } from "@capacitor/preferences";
import { LocalNotifications } from "@capacitor/local-notifications";

// Registers native push (FCM) with the relay and displays the resulting
// notifications, for the Capacitor shell only.
//
// This has to live here rather than in mobile/src/index.ts: capacitor.config.ts
// runs the app in remote-URL mode (`server.url`), so the WebView navigates
// straight to this webui and mobile/www's bundled JS never executes. Without
// this component, PushNotifications.register() is never called on either
// platform and mobile push silently never starts — the relay routes at
// app/api/push/mobile/* have nothing calling them. See mobile/README.md.
//
// Registering isn't the whole story, though: @capacitor/push-notifications
// only ever hands the raw FCM message to JS (its Android MessagingService
// does nothing but re-emit the event — confirmed from its own source) and
// never builds a system notification itself. That part — fetch the actual
// unread email, then LocalNotifications.schedule() — is showNotificationFor()
// below, mirroring what public/sw.js already does for Web Push.
//
// isNativePlatform() is false in every ordinary browser tab, so this is a
// no-op outside the Capacitor shell — importing these packages does not pull
// in any native code on web, they're pure-JS shims there.

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

// LocalNotifications ids are numeric; JMAP email ids are arbitrary strings.
// djb2, stays within a safe positive int32 range so it can't collide with
// the fixed ids below.
function stableNotificationId(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 33) ^ s.charCodeAt(i);
  }
  return (hash >>> 0) % 0x7fffffff || 1;
}

// The generic "New mail" fallback always reuses this id so repeats replace
// rather than stack — same intent as sw.js's tag: "bulwark-mail".
const GENERIC_NOTIFICATION_ID = 1_000_000_000;

type PushPreview = {
  email: {
    id: string;
    threadId: string;
    from?: { name?: string | null; email?: string }[] | null;
    subject?: string | null;
    preview?: string | null;
  } | null;
  unreadTotal?: number;
};

/**
 * @capacitor/push-notifications only forwards the raw FCM message to JS — it
 * never builds an Android/iOS system notification itself (confirmed from its
 * own MessagingService.java: onMessageReceived does nothing but re-emit the
 * event). Every notification.showNotification() call in this codebase before
 * this was web-only (public/sw.js's push handler). Mirrors that handler:
 * data-only push -> look up the actual unread email -> build one notification
 * from it, falling back to a generic one if the lookup fails, staying silent
 * if it succeeds and genuinely finds nothing (stragglers from a stale
 * subscription, read-race, or a bare verification ping).
 */
async function showNotificationFor(data: PushNotificationSchema["data"]): Promise<void> {
  if (data?.type !== "email-delivery") return;

  let preview: PushPreview | null = null;
  let previewOk = false;
  try {
    const res = await fetch("/api/push/preview", { credentials: "include", cache: "no-store" });
    if (res.ok) {
      preview = (await res.json()) as PushPreview;
      previewOk = true;
    }
  } catch {
    preview = null;
  }

  const email = preview?.email ?? null;
  const unreadTotal = typeof preview?.unreadTotal === "number" ? preview.unreadTotal : 0;

  if (previewOk && !email && unreadTotal === 0) return;

  const accountLabel = typeof data?.accountLabel === "string" ? data.accountLabel : "";

  let id: number;
  let title: string;
  let body: string;
  let extra: Record<string, unknown>;

  if (email) {
    const sender = email.from?.[0];
    const senderName = sender?.name || sender?.email || "New mail";
    id = stableNotificationId(email.id);
    title = senderName + (accountLabel ? ` (${accountLabel})` : "");
    body = email.subject || email.preview || "(no subject)";
    extra = { kind: "email", emailId: email.id, threadId: email.threadId };
  } else {
    id = GENERIC_NOTIFICATION_ID;
    title = accountLabel ? `New mail (${accountLabel})` : "New mail";
    body = unreadTotal > 1 ? `${unreadTotal} unread messages` : "You have new mail";
    extra = { kind: "mail-list" };
  }

  await LocalNotifications.schedule({
    // Without smallIcon, LocalNotifications' Android implementation falls
    // back to a built-in system icon (android.R.drawable.ic_dialog_info,
    // verified from its source before relying on it — see the earlier
    // comment on why that's safe), not the app's own. iconColor matches the
    // tint fcm-sender.ts's android.notification.color uses for the same
    // notification arriving via the other path (background/killed), so the
    // two look the same regardless of which one actually fired — status bar
    // icons are always rendered as a flat silhouette either way, so the
    // source PNG's own colors never show through regardless.
    notifications: [
      { id, title, body, extra, smallIcon: "ic_launcher_monochrome", iconColor: "#FF6584" },
    ],
  });
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
    let receivedListener: { remove: () => void } | undefined;
    let tapListener: { remove: () => void } | undefined;
    let localTapListener: { remove: () => void } | undefined;

    (async () => {
      // Android 13+ (targetSdk 33+) requires this explicit runtime check; iOS
      // and older Android fold it into requestPermissions() below regardless.
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== "granted") {
        console.warn("[Push] Permission denied");
        return;
      }
      // Separate OS-level grant LocalNotifications needs to actually post the
      // notification we build in showNotificationFor(). In practice Android
      // treats POST_NOTIFICATIONS as one permission shared by both plugins —
      // this call is what makes that explicit rather than relying on that
      // holding true forever.
      await LocalNotifications.requestPermissions();

      registrationListener = await PushNotifications.addListener(
        "registration",
        ({ value: fcmToken }) => {
          void registerWithServer(fcmToken, controller.signal);
        },
      );
      errorListener = await PushNotifications.addListener("registrationError", (err) => {
        console.error("[Push] Registration error:", err);
      });

      // The FCM message itself never produces a visible notification on its
      // own — see showNotificationFor's comment. This fires whenever the
      // native side receives one, foreground or background (Android keeps
      // delivering data messages to a live app process either way).
      receivedListener = await PushNotifications.addListener(
        "pushNotificationReceived",
        (notification) => {
          void showNotificationFor(notification.data).catch((err) => {
            console.error("[Push] Failed to show notification:", err);
          });
        },
      );

      // Deep-linking a tapped notification straight to the email it's for needs
      // a route that reads it (e.g. a `?email=` param page.tsx picks up) — that
      // doesn't exist yet, so this only logs for now rather than navigating
      // somewhere broken. The WebView is already this app, so a background tap
      // just foregrounds it as-is in the meantime. Both listeners are wired:
      // pushNotificationActionPerformed fires only in the rare case Android's
      // own notification tray forwards the raw FCM payload back to us directly
      // (bypassing showNotificationFor entirely); the LocalNotifications one
      // below is what actually fires for the notification this file creates.
      tapListener = await PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (action) => {
          console.log("[Push] Notification tapped:", action.notification.data);
        },
      );
      localTapListener = await LocalNotifications.addListener(
        "localNotificationActionPerformed",
        (action) => {
          console.log("[Push] Notification tapped:", action.notification.extra);
        },
      );

      await PushNotifications.register();
    })();

    return () => {
      controller.abort();
      registrationListener?.remove();
      errorListener?.remove();
      receivedListener?.remove();
      tapListener?.remove();
      localTapListener?.remove();
    };
  }, []);

  return null;
}
