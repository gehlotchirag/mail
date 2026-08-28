// Simple in-process sliding-window rate limiter.
// Works for a single Next.js process (PM2 fork mode, one instance).
// Replace with Redis-based limiter (Upstash) when scaling to multiple instances.

interface Window {
  count: number;
  resetAt: number;
}

const store = new Map<string, Window>();

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    // Prune stale keys periodically to prevent memory leak
    if (store.size > 10_000) {
      for (const [k, v] of store) {
        if (now > v.resetAt) store.delete(k);
      }
    }
    return { allowed: true, remaining: limit - 1 };
  }

  entry.count++;
  if (entry.count > limit) return { allowed: false, remaining: 0 };
  return { allowed: true, remaining: limit - entry.count };
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    'unknown'
  );
}
