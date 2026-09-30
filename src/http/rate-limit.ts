/** The requests counted so far in the current window for one subject. */
interface Window {
  start: number;
  count: number;
}

/** Whether a request may go ahead, and how long to wait when it may not. */
export interface RateVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Above this many tracked callers, expired windows are swept out so memory stays bounded. */
const MAX_TRACKED_SUBJECTS = 10_000;

/** A fixed-window counter kept in memory, which is enough for a single server process. */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts a request for `subject` and says whether it is within the limit. */
  check(subject: string): RateVerdict {
    const time = this.now();
    if (this.windows.size >= MAX_TRACKED_SUBJECTS) this.prune(time);

    const current = this.windows.get(subject);
    const window =
      current && time - current.start < this.windowMs ? current : { start: time, count: 0 };
    window.count += 1;
    this.windows.set(subject, window);

    const retryAfterSeconds = Math.max(1, Math.ceil((window.start + this.windowMs - time) / 1000));
    return { allowed: window.count <= this.limit, retryAfterSeconds };
  }

  /** Drops the windows that have ended. */
  private prune(time: number): void {
    for (const [subject, window] of this.windows) {
      if (time - window.start >= this.windowMs) this.windows.delete(subject);
    }
  }
}
