"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

const DISMISSED_KEY = "arham_playstore_banner_dismissed";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=tech.arhamworkspace.inbox&hl=en";

export function PlayStoreBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [playStoreLink, setPlayStoreLink] = useState(PLAY_STORE_URL);

  useEffect(() => {
    // 1. Check if user already dismissed banner in this session
    if (typeof window === "undefined") return;
    try {
      if (sessionStorage.getItem(DISMISSED_KEY) === "1") return;
    } catch {
      // ignore storage access issues
    }

    // 2. Hide if running inside native Capacitor wrapper (Android/iOS app)
    const isCapacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      ?.Capacitor?.isNativePlatform?.();
    if (isCapacitor) return;

    // 3. Capture UTM parameters from URL or sessionStorage
    const params = new URLSearchParams(window.location.search);
    const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"];
    const currentUtms: Record<string, string> = {};
    let foundNew = false;

    utmKeys.forEach((key) => {
      const val = params.get(key);
      if (val) {
        currentUtms[key] = val;
        foundNew = true;
      }
    });

    if (foundNew) {
      try {
        sessionStorage.setItem("arham_utm", JSON.stringify(currentUtms));
      } catch {}
    } else {
      try {
        const stored = sessionStorage.getItem("arham_utm");
        if (stored) Object.assign(currentUtms, JSON.parse(stored));
      } catch {}
    }

    // 4. Build Play Store URL with parameters & encoded referrer
    let target = PLAY_STORE_URL;
    const referrerParts: string[] = [];
    let hasSource = false;

    Object.keys(currentUtms).forEach((k) => {
      target += `&${encodeURIComponent(k)}=${encodeURIComponent(currentUtms[k])}`;
      referrerParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(currentUtms[k])}`);
      if (k === "utm_source") hasSource = true;
    });

    if (!hasSource) {
      referrerParts.push("utm_source%3Darham_webmail");
      referrerParts.push("utm_medium%3Dheader_banner");
    }
    if (!currentUtms["utm_content"]) {
      referrerParts.push("utm_content%3Dplaystore_header");
    }

    if (referrerParts.length > 0) {
      target += `&referrer=${referrerParts.join("%26")}`;
    }

    setPlayStoreLink(target);
    setShowBanner(true);
  }, []);

  const handleDismiss = () => {
    setShowBanner(false);
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {}
  };

  if (!showBanner) return null;

  return (
    <div className="w-full bg-white dark:bg-[#0B1739] border-b border-[#E2EAF5] dark:border-[#1E2D4A] shadow-sm relative z-50 transition-all">
      <div className="max-w-7xl mx-auto px-3 py-2 flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={handleDismiss}
            className="p-1 rounded-md text-[#94A3B8] hover:text-[#0B1739] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            aria-label="Dismiss banner"
          >
            <X className="w-4 h-4" />
          </button>
          
          <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0 border border-[#E2EAF5] dark:border-[#1E2D4A] shadow-xs bg-white p-0.5 flex items-center justify-center">
            {/* Play store style app icon */}
            <img
              src="/icon-192x192.png"
              alt="Arham INBOX"
              className="w-full h-full object-cover rounded-lg"
              onError={(e) => {
                // fallback to SVG if PNG fails
                (e.target as HTMLImageElement).src = "/branding/Inbox_Logo_Color.svg";
              }}
            />
          </div>

          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-bold text-[#0B1739] dark:text-[#F7FAFF] truncate leading-tight">
              INBOX by Arham Workspace
            </div>
            <div className="text-[10.5px] sm:text-xs text-[#607392] dark:text-[#94A3B8] truncate leading-tight mt-0.5">
              Rated 4.9 ★ • Google Play Store
            </div>
          </div>
        </div>

        <a
          href={playStoreLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-white bg-[#0866F5] hover:bg-[#0756D8] shadow-sm hover:shadow transition-all shrink-0 whitespace-nowrap active:scale-95"
        >
          {/* Google Play Triangle Icon */}
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
            <path d="M3.609 1.814L13.793 12 3.61 22.186a2.38 2.38 0 0 1-.22-.976V2.79c0-.36.08-.7.22-.976zm11.242 11.243l2.25 2.25-11.83 6.64 9.58-8.89zm0-2.114L5.27 2.052l11.83 6.64-2.25 2.251zm1.472 1.057l3.87 2.172c.98.55.98 1.45 0 2l-3.87 2.172-2.38-2.38 2.38-2.38z" />
          </svg>
          <span>Install from Play Store</span>
        </a>
      </div>
    </div>
  );
}
