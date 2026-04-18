import { Semaphore } from "../generation/semaphore.js";

export type TokenBucketOptions = {
  /** Max in-flight requests. Defaults to 6. */
  maxConcurrent?: number;
  /** Minimum milliseconds between request launches. Defaults to 0 (no spacing). */
  minIntervalMs?: number;
};

/**
 * Provider-scoped rate limiter combining a concurrency cap with per-launch
 * interval spacing. Observed need: some providers (e.g., `kingxliu`) cap
 * individual-developer plans with an HTTP 429 `rate_limit_error` when the
 * job's forkWorkers + pageConcurrency saturate their QPS. The ai-sdk's
 * internal retry does not back the caller off enough to avoid repeated
 * rate limit hits.
 *
 * `acquire()` blocks until a concurrency permit is available AND enough
 * time has passed since the previous launch. `release()` must be called in
 * a `finally` block, regardless of success or failure of the wrapped call.
 */
export class TokenBucket {
  private readonly sem: Semaphore;
  private readonly minIntervalMs: number;
  /** Serializes the "last launch" update so concurrent acquirers respect spacing. */
  private nextAvailableAt = 0;

  constructor(options: TokenBucketOptions = {}) {
    const maxConcurrent = options.maxConcurrent ?? 6;
    if (maxConcurrent < 1) {
      throw new Error(`maxConcurrent must be >= 1, got ${maxConcurrent}`);
    }
    this.sem = new Semaphore(maxConcurrent);
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? 0);
  }

  async acquire(): Promise<void> {
    await this.sem.acquire();
    if (this.minIntervalMs > 0) {
      const now = Date.now();
      const wait = this.nextAvailableAt - now;
      // Reserve the next launch slot BEFORE sleeping so concurrent callers
      // that already hold a permit queue up rather than racing on the clock.
      this.nextAvailableAt = Math.max(now, this.nextAvailableAt) + this.minIntervalMs;
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  release(): void {
    this.sem.release();
  }
}

/** Wrap a fetch function so every call passes through the bucket. */
export function createRateLimitedFetch(
  inner: typeof globalThis.fetch,
  bucket: TokenBucket,
): typeof globalThis.fetch {
  return async (input, init) => {
    await bucket.acquire();
    try {
      return await inner(input, init);
    } finally {
      bucket.release();
    }
  };
}

/**
 * Module-level cache of provider → bucket. Shared across all model
 * instances of the same provider within a single process so the bucket
 * counts every request regardless of role (catalog/outline/drafter/worker/reviewer).
 */
const providerBuckets = new Map<string, TokenBucket>();

export function getProviderBucket(
  providerName: string,
  options?: TokenBucketOptions,
): TokenBucket {
  const cached = providerBuckets.get(providerName);
  if (cached) return cached;
  const bucket = new TokenBucket(options);
  providerBuckets.set(providerName, bucket);
  return bucket;
}

/** Reset the cache — exported for tests. */
export function resetProviderBucketsForTest(): void {
  providerBuckets.clear();
}
