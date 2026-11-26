import { HttpError } from "./engines/types.js";

export interface RetryOptions {
  /** Total attempts including the first. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
}

/** A 429 that means "out of credits/quota" rather than "slow down"; retrying can't help. */
const OUT_OF_CREDITS = /insufficient_quota|credit_balance_exhausted|billing/i;

/** Errors worth retrying: rate limits, server errors, timeouts and dropped connections. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) {
    if (err.status === 429) return !OUT_OF_CREDITS.test(err.body);
    return err.status === 408 || err.status >= 500;
  }
  if (err instanceof Error) {
    // fetch() throws TypeError on network failure; AbortSignal.timeout() throws TimeoutError.
    return err.name === "TimeoutError" || err.name === "AbortError" || err.name === "TypeError";
  }
  return false;
}

/**
 * Run `fn`, retrying retryable failures with exponential backoff and jitter
 * (1s, 2s, 4s … capped), honouring a server's Retry-After header when present.
 * Each retry is a brand-new request.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<{ value: T; attempts: number }> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const base = opts.baseDelayMs ?? 1_000;
  const cap = opts.maxDelayMs ?? 30_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let attempt = 1; ; attempt++) {
    try {
      return { value: await fn(), attempts: attempt };
    } catch (err) {
      if (attempt >= maxAttempts || !isRetryable(err)) {
        throw Object.assign(err instanceof Error ? err : new Error(String(err)), { attempts: attempt });
      }
      const backoff = Math.min(cap, base * 2 ** (attempt - 1)) * (1 + Math.random() * 0.3);
      const hinted = err instanceof HttpError && err.retryAfterMs !== null ? Math.min(err.retryAfterMs, 60_000) : 0;
      const delay = Math.round(Math.max(backoff, hinted));
      opts.onRetry?.(attempt, delay, err);
      await sleep(delay);
    }
  }
}

/** Attempts made before a failure (set by withRetry on the thrown error). */
export function attemptsOf(err: unknown): number {
  const n = (err as { attempts?: unknown } | null)?.attempts;
  return typeof n === "number" ? n : 1;
}
