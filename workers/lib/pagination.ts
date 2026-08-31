/**
 * Guard for provider pagination loops.
 *
 * A `while (true)` loop that only exits on the provider saying `hasMore: false`
 * is at the mercy of the provider: an API that keeps answering `hasMore: true`
 * with the same page (a broken cursor, a caching proxy, an offset it silently
 * clamps) spins forever, re-enqueuing the same messages until the disk fills.
 * Two independent stops: a hard iteration cap, and a repeated-page detector.
 */
export type PageVerdict =
  | { ok: true }
  | { ok: false; reason: 'max-pages' | 'repeated-page'; detail: string };

/**
 * Signature identifying a page BY ITS CONTENTS.
 *
 * Deliberately excludes the request offset: the offset advances on every
 * iteration, so folding it in makes two identical pages look different and
 * silently disables the repeated-page stop. Contents only.
 */
export function pageSignature(firstId: string, lastId: string, count: number): string {
  return `${firstId}:${lastId}:${count}`;
}

export class PageGuard {
  private pages = 0;
  private lastSignature: string | null = null;

  constructor(
    private readonly maxPages: number,
    private readonly label: string,
  ) {}

  /**
   * Call once per page fetched, with a signature identifying the page's contents
   * (e.g. first and last message id). Returns a verdict; stop the loop on !ok.
   */
  next(signature: string): PageVerdict {
    this.pages++;
    if (this.pages > this.maxPages) {
      return {
        ok: false,
        reason: 'max-pages',
        detail: `${this.label}: pagination cap of ${this.maxPages} pages hit — ` +
          'the provider never reported the end of the folder',
      };
    }
    if (this.lastSignature !== null && signature === this.lastSignature) {
      return {
        ok: false,
        reason: 'repeated-page',
        detail: `${this.label}: cursor stopped advancing — the provider returned ` +
          `the same page twice (signature ${signature}) while still reporting more results`,
      };
    }
    this.lastSignature = signature;
    return { ok: true };
  }

  get pagesFetched(): number { return this.pages; }
}
