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

  async acquire(signal?: AbortSignal): Promise<void> {
    await this.sem.acquire(signal);
    if (this.minIntervalMs > 0) {
      const now = Date.now();
      const wait = this.nextAvailableAt - now;
      // Reserve the next launch slot BEFORE sleeping so concurrent callers
      // that already hold a permit queue up rather than racing on the clock.
      this.nextAvailableAt = Math.max(now, this.nextAvailableAt) + this.minIntervalMs;
      if (wait > 0) {
        await abortableDelay(wait, signal);
      }
    }
  }

  release(): void {
    this.sem.release();
  }
}

/**
 * Wrap a fetch function so every call passes through the bucket.
 *
 * The permit is held from `acquire()` until the response body is fully
 * consumed / cancelled / errored — NOT merely until the headers return.
 * That distinction matters for streaming (SSE) providers where a single
 * generation can hold the connection for tens of seconds; releasing on
 * headers-return would let another call start and keep the true in-flight
 * count above `maxConcurrent`, defeating the whole point of the bucket.
 *
 * Non-streaming responses still go through the wrapper — their bodies are
 * read almost immediately by callers (e.g. `response.json()`), so the
 * overhead is negligible and the semantics stay simple.
 */
export function createRateLimitedFetch(
  inner: typeof globalThis.fetch,
  bucket: TokenBucket,
): typeof globalThis.fetch {
  return async (input, init) => {
    // Forward the caller's AbortSignal so an outer wall-clock timeout can
    // unstick an acquire() that would otherwise wait forever if permits leak.
    await bucket.acquire(init?.signal ?? undefined);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      bucket.release();
    };

    let response: Response;
    try {
      response = await inner(input, init);
    } catch (err) {
      // Failure before we ever got a response — nothing to hold open.
      release();
      throw err;
    }

    // Bodyless responses (HEAD, 204 No Content, etc.) → nothing to read.
    if (!response.body) {
      release();
      return response;
    }

    const reader = response.body.getReader();
    const wrappedBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            release();
            controller.close();
          } else {
            controller.enqueue(value);
          }
        } catch (err) {
          release();
          controller.error(err);
        }
      },
      cancel(reason) {
        release();
        return reader.cancel(reason);
      },
    });

    return new Response(wrappedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
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

/** Sleep for `ms` milliseconds, aborting early when `signal` fires. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((r) => setTimeout(r, ms));
  }
  if (signal.aborted) {
    return Promise.reject(signalAbortReason(signal));
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signalAbortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function signalAbortReason(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  if (reason !== undefined) return new Error(String(reason));
  return new DOMException("The operation was aborted.", "AbortError");
}
