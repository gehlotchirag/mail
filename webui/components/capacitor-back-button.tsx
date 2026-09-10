"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { useUIStore } from "@/stores/ui-store";

// Android's hardware/gesture back button has no default handler in this app,
// so Capacitor falls through to its own default: exit the app. There's no
// in-app history to go back through either — the mobile list/viewer/sidebar
// transitions are Zustand state (useUIStore), not router or browser-history
// driven — so App.addListener('backButton', ({canGoBack}) => ...) reading
// canGoBack wouldn't help; it reads the WebView's navigation history, which
// this app doesn't use for these transitions.
//
// Instead this mirrors what the in-app back arrow already does, extended to
// the one state it doesn't cover: the open sidebar drawer.
//   sidebar open  -> close it
//   viewing an email -> back to the list (useUIStore's own goBack())
//   otherwise (root list, nothing open) -> exit, the platform default
//
// Doesn't cover other overlays (compose, settings, the email-viewer "more
// actions" panel, dialogs) — those still fall through to exiting the app.
// Extend the priority list below if one of those turns out to matter too.
export function CapacitorBackButton() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const listenerPromise = App.addListener("backButton", () => {
      const { sidebarOpen, activeView, setSidebarOpen, goBack } = useUIStore.getState();

      if (sidebarOpen) {
        setSidebarOpen(false);
        return;
      }
      if (activeView === "viewer") {
        goBack();
        return;
      }
      App.exitApp();
    });

    return () => {
      void listenerPromise.then((l) => l.remove());
    };
  }, []);

  return null;
}
