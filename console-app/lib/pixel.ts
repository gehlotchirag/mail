declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/** Fires a Meta Pixel event from the browser. No-ops if the pixel script (see
 * app/layout.tsx) hasn't loaded yet or this runs server-side. */
export function trackPixel(event: string, params?: Record<string, unknown>) {
  if (typeof window === 'undefined' || !window.fbq) return;
  window.fbq('track', event, params);
}
