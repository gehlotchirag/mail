/**
 * Batched progress accounting for message imports.
 *
 * Progress is flushed to the database every N messages so a long batch shows
 * movement without one UPDATE per message. The trap this exists to close: the
 * message counter and the byte counter must be flushed *together*. The previous
 * hand-rolled version flushed messages every 10 and passed bytes as 0, then
 * relied on a trailing `if (counter > 0)` to record the bytes — so any batch
 * whose message count was an exact multiple of the flush size ended with the
 * counter at 0 and dropped every byte it had imported. With a batch size of 50
 * and a flush size of 10 that was the common case, not an edge case.
 */
export class ProgressAccumulator {
  private pendingMessages = 0;
  private pendingBytes = 0;
  private flushedMessages = 0;
  private flushedBytes = 0;

  constructor(
    private readonly flushEvery: number,
    private readonly flush: (messages: number, bytes: number) => Promise<void>,
  ) {}

  /** Record one imported message; flushes once `flushEvery` have accumulated. */
  async record(bytes: number): Promise<void> {
    this.pendingMessages++;
    this.pendingBytes += bytes;
    if (this.pendingMessages >= this.flushEvery) await this.drain();
  }

  /** Flush whatever is still buffered. Safe to call when nothing is pending. */
  async drain(): Promise<void> {
    if (this.pendingMessages === 0 && this.pendingBytes === 0) return;
    const messages = this.pendingMessages;
    const bytes = this.pendingBytes;
    this.pendingMessages = 0;
    this.pendingBytes = 0;
    this.flushedMessages += messages;
    this.flushedBytes += bytes;
    await this.flush(messages, bytes);
  }

  /** Totals recorded so far, including anything not yet flushed. */
  get totals(): { messages: number; bytes: number } {
    return {
      messages: this.flushedMessages + this.pendingMessages,
      bytes: this.flushedBytes + this.pendingBytes,
    };
  }

  get unflushed(): { messages: number; bytes: number } {
    return { messages: this.pendingMessages, bytes: this.pendingBytes };
  }
}
