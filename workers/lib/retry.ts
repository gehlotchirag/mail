export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts: number; baseDelayMs: number; maxDelayMs?: number }
): Promise<T> {
  const max = opts.maxDelayMs ?? 300_000;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= opts.maxAttempts) throw err;
      const delay = Math.min(opts.baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000, max);
      await sleep(delay);
    }
  }
  throw new Error('exhausted');
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isImapRateLimit(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('421') || msg.includes('454') || msg.includes('rate') || msg.includes('too many');
}
