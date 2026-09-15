"use client";

import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications, type PushNotificationSchema } from "@capacitor/push-notifications";
import { Preferences } from "@capacitor/preferences";
import { LocalNotifications } from "@capacitor/local-notifications";
import { useAccountStore } from "@/stores/account-store";

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

// Each logged-in account gets its own JMAP PushSubscription (and thus its
// own deviceClientId), keyed by cookie slot — a single global id can only
// ever be bound to one account's credentials server-side.
function deviceIdKey(slot: number): string {
  return `pushDeviceClientId:slot:${slot}`;
}

async function getStoredDeviceClientId(slot: number): Promise<string | null> {
  const { value } = await Preferences.get({ key: deviceIdKey(slot) });
  return value ?? null;
}

async function saveDeviceClientId(slot: number, id: string): Promise<void> {
  await Preferences.set({ key: deviceIdKey(slot), value: id });
}

async function clearDeviceClientId(slot: number): Promise<void> {
  await Preferences.remove({ key: deviceIdKey(slot) });
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
 * Register the FCM token with the relay for one account (cookie slot).
 * Retries indefinitely with backoff:
 * - 401 means that slot isn't logged in yet (the request carries the slot's
 *   session cookie automatically via X-JMAP-Cookie-Slot) — keep retrying
 *   until it is.
 * - Any other failure (relay hiccup, network blip) also retries; there's no
 *   user-facing surface to report failure to from here.
 */
async function registerWithServer(fcmToken: string, slot: number, signal: AbortSignal): Promise<void> {
  const existingDeviceClientId = await getStoredDeviceClientId(slot);
  let delay = 2000;

  while (!signal.aborted) {
    try {
      const res = await fetch("/api/push/mobile/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-JMAP-Cookie-Slot": String(slot),
        },
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
        await saveDeviceClientId(slot, data.deviceClientId);
      }
      return;
    } catch (err) {
      if (signal.aborted) return;
      console.warn(`[Push] Registration attempt failed for slot ${slot}, retrying...`, err);
      await sleep(delay);
      delay = Math.min(Math.floor(delay * 1.5), 30_000);
    }
  }
}

/** Deregister a previously-registered account (e.g. after it's removed from the app). */
async function deregisterWithServer(slot: number): Promise<void> {
  const deviceClientId = await getStoredDeviceClientId(slot);
  if (!deviceClientId) return;
  try {
    await fetch(`/api/push/mobile/register?deviceClientId=${deviceClientId}`, {
      method: "DELETE",
      headers: { "X-JMAP-Cookie-Slot": String(slot) },
      credentials: "include",
    });
  } catch (err) {
    console.warn(`[Push] Deregistration failed for slot ${slot}`, err);
  } finally {
    await clearDeviceClientId(slot);
  }
}

export function CapacitorPushRegistration() {
  // One FCM token per device, but one JMAP PushSubscription per logged-in
  // account (cookie slot) — each needs its own server-side registration so
  // notifications for every added account actually get delivered, not just
  // whichever account happened to resolve first server-side.
  const accounts = useAccountStore((s) => s.accounts);
  const connectedSlots = accounts.filter((a) => a.isConnected).map((a) => a.cookieSlot);
  const slotsKey = [...connectedSlots].sort((a, b) => a - b).join(",");

  const fcmTokenRef = useRef<string | null>(null);
  const connectedSlotsRef = useRef<number[]>(connectedSlots);
  connectedSlotsRef.current = connectedSlots;
  const controllersRef = useRef<Map<number, AbortController>>(new Map());

  const syncSlots = (slots: number[]) => {
    const fcmToken = fcmTokenRef.current;
    if (!fcmToken) return;
    const slotSet = new Set(slots);

    for (const slot of slots) {
      if (controllersRef.current.has(slot)) continue;
      const controller = new AbortController();
      controllersRef.current.set(slot, controller);
      void registerWithServer(fcmToken, slot, controller.signal);
    }

    for (const [slot, controller] of controllersRef.current) {
      if (slotSet.has(slot)) continue;
      controller.abort();
      controllersRef.current.delete(slot);
      void deregisterWithServer(slot);
    }
  };

  // Re-sync whenever the set of logged-in accounts changes (account added,
  // removed, or logged out) — not just once at mount.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    syncSlots(connectedSlots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotsKey]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

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
          fcmTokenRef.current = fcmToken;
          syncSlots(connectedSlotsRef.current);
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
      // controllersRef is a plain instance-variable ref (grown over the
      // effect's lifetime by syncSlots as accounts are added/removed), not a
      // DOM node ref — reading .current here intentionally, not stale.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      for (const controller of controllersRef.current.values()) controller.abort();
      controllersRef.current.clear();
      registrationListener?.remove();
      errorListener?.remove();
      receivedListener?.remove();
      tapListener?.remove();
      localTapListener?.remove();
    };
  }, []);

  return null;
}
