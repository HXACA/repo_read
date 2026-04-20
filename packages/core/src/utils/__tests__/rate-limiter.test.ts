import { describe, it, expect, beforeEach } from "vitest";
import {
  TokenBucket,
  createRateLimitedFetch,
  getProviderBucket,
  resetProviderBucketsForTest,
} from "../rate-limiter.js";

describe("TokenBucket", () => {
  it("rejects invalid maxConcurrent", () => {
    expect(() => new TokenBucket({ maxConcurrent: 0 })).toThrow();
  });

  it("caps concurrency to maxConcurrent", async () => {
    const bucket = new TokenBucket({ maxConcurrent: 2 });
    let inFlight = 0;
    let peak = 0;

    const task = async (ms: number) => {
      await bucket.acquire();
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight--;
      bucket.release();
    };

    await Promise.all([task(40), task(40), task(40), task(40), task(40)]);
    expect(peak).toBe(2);
  });

  it("enforces minIntervalMs spacing between acquires", async () => {
    const bucket = new TokenBucket({ maxConcurrent: 10, minIntervalMs: 30 });
    const launchedAt: number[] = [];
    const start = Date.now();

    const task = async () => {
      await bucket.acquire();
      launchedAt.push(Date.now() - start);
      bucket.release();
    };

    await Promise.all([task(), task(), task(), task()]);

    // Each consecutive launch must be at least minIntervalMs apart
    for (let i = 1; i < launchedAt.length; i++) {
      const gap = launchedAt[i] - launchedAt[i - 1];
      expect(gap).toBeGreaterThanOrEqual(25); // small leeway for scheduler jitter
    }
  });

  it("minIntervalMs=0 applies no spacing", async () => {
    const bucket = new TokenBucket({ maxConcurrent: 10, minIntervalMs: 0 });
    const launchedAt: number[] = [];
    const start = Date.now();

    const task = async () => {
      await bucket.acquire();
      launchedAt.push(Date.now() - start);
      bucket.release();
    };

    await Promise.all([task(), task(), task()]);
    expect(Math.max(...launchedAt)).toBeLessThan(15);
  });

  it("releases permits even when the wrapped call throws", async () => {
    const bucket = new TokenBucket({ maxConcurrent: 1 });
    const failing = () => Promise.reject(new Error("boom"));
    const wrapped = createRateLimitedFetch(failing as unknown as typeof fetch, bucket);

    await expect(wrapped("https://example.test")).rejects.toThrow("boom");

    // If the permit leaked, this second call would hang forever. Add a hard
    // timeout guard to fail fast if release was skipped.
    const succeeded = await Promise.race([
      wrapped("https://example.test").catch(() => "released"),
      new Promise((_, rej) => setTimeout(() => rej(new Error("permit leaked")), 200)),
    ]);
    expect(succeeded).toBe("released");
  });

  it("holds the permit until a streaming body is fully consumed", async () => {
    // Core regression guard: the old rate limiter released on Response return,
    // so a long SSE stream would free its permit immediately and let other
    // callers start. With a streaming-aware wrapper, maxConcurrent=1 means
    // only one stream can be ACTIVELY reading at a time.
    const bucket = new TokenBucket({ maxConcurrent: 1 });
    let inFlight = 0;
    let peak = 0;
    const openStreams: Array<{ push: (x: string) => void; close: () => void }> = [];

    const fakeFetch = async (): Promise<Response> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          openStreams.push({
            push: (chunk: string) => controller.enqueue(new TextEncoder().encode(chunk)),
            close: () => {
              inFlight--;
              controller.close();
            },
          });
        },
      });
      return new Response(body, { status: 200 });
    };

    const wrapped = createRateLimitedFetch(fakeFetch as unknown as typeof fetch, bucket);

    // Kick off two requests. Only the first should actually hit fakeFetch
    // because permit 1 is held by the (unconsumed) streaming body.
    const p1 = wrapped("https://a.test").then((r) => r.body!.getReader().read().then(() => r));
    const p2 = wrapped("https://b.test").then((r) => r.body!.getReader().read().then(() => r));

    // Drain the event loop so p1's fakeFetch runs.
    await new Promise((r) => setTimeout(r, 20));
    expect(openStreams).toHaveLength(1);
    expect(peak).toBe(1);

    // Close stream 1 → permit released → p2 acquires → fakeFetch fires.
    openStreams[0].push("payload-1");
    openStreams[0].close();
    await new Promise((r) => setTimeout(r, 20));
    expect(openStreams).toHaveLength(2);
    expect(peak).toBe(1); // never more than one active at a time

    openStreams[1].push("payload-2");
    openStreams[1].close();

    await p1;
    await p2;
  });

  it("releases the permit when a streaming body is cancelled", async () => {
    const bucket = new TokenBucket({ maxConcurrent: 1 });
    let cancelled = false;
    const fakeFetch = async () => {
      const body = new ReadableStream<Uint8Array>({
        pull() {
          // Never enqueue — this stream would run forever if the caller
          // doesn't cancel it.
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, { status: 200 });
    };
    const wrapped = createRateLimitedFetch(fakeFetch as unknown as typeof fetch, bucket);

    const r1 = await wrapped("https://a.test");
    // Cancel the consumer side — our wrapper's cancel() should fire and
    // release the permit so a second call can proceed.
    await r1.body!.cancel();
    expect(cancelled).toBe(true);

    const r2 = await Promise.race([
      wrapped("https://b.test"),
      new Promise((_, rej) => setTimeout(() => rej(new Error("permit leaked on cancel")), 300)),
    ]);
    expect((r2 as Response).status).toBe(200);
    await (r2 as Response).body?.cancel();
  });

  it("releases the permit for bodyless responses", async () => {
    const bucket = new TokenBucket({ maxConcurrent: 1 });
    const fakeFetch = async () => new Response(null, { status: 204 });
    const wrapped = createRateLimitedFetch(fakeFetch as unknown as typeof fetch, bucket);
    await wrapped("https://a.test");

    // If the permit leaked, this second call would hang.
    const r = await Promise.race([
      wrapped("https://b.test"),
      new Promise((_, rej) => setTimeout(() => rej(new Error("permit leaked on null body")), 300)),
    ]);
    expect((r as Response).status).toBe(204);
  });

  it("releases the semaphore permit when the min-interval delay is aborted (H1 regression)", async () => {
    // Bug: bucket.acquire(signal) takes a permit via sem.acquire(), then
    // waits on the minIntervalMs spacing delay. If `signal` aborts the
    // delay, the permit was NEVER released — the bucket ends up one permit
    // short forever, which over time defeats the whole wall-clock recovery
    // story (the very thing the abort signal exists for).
    const bucket = new TokenBucket({ maxConcurrent: 1, minIntervalMs: 500 });

    // Warm the nextAvailableAt so the next acquire has real spacing to wait on.
    await bucket.acquire();
    bucket.release();

    const doomed = new AbortController();
    setTimeout(() => doomed.abort(new Error("signal fired mid-delay")), 30);
    await expect(bucket.acquire(doomed.signal)).rejects.toThrow("signal fired mid-delay");

    // The permit MUST be available again. If not, this second acquire hangs
    // past the timeout and the test fails.
    const start = Date.now();
    await Promise.race([
      bucket.acquire(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("permit leaked after aborted delay")), 1200),
      ),
    ]);
    // Sanity check: the second acquire itself had to wait for nextAvailableAt
    // to elapse, but must complete well under the leak-guard timeout.
    expect(Date.now() - start).toBeLessThan(1100);
    bucket.release();
  });

  it("forwards init.signal so a waiter stuck on acquire can be aborted", async () => {
    // Unsticks the permit-leak class of hang: if an outer wall-clock timeout
    // fires while the request is still blocked on acquire(), propagating the
    // signal rejects the waiter rather than parking forever.
    const bucket = new TokenBucket({ maxConcurrent: 1 });
    // First request holds the only permit by never-closing stream
    const stall = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            pull() {
              // Never enqueue, never close — just like a hanging LLM stream
            },
          }),
          { status: 200 },
        ),
      );
    const wrapped = createRateLimitedFetch(stall as unknown as typeof fetch, bucket);
    const first = await wrapped("https://stall.test");
    // Ensure first permit is held
    expect(first.status).toBe(200);

    // Second request with a signal that aborts after 40ms
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(new Error("wall-clock fired")), 40);
    await expect(
      wrapped("https://queued.test", { signal: ctrl.signal }),
    ).rejects.toThrow("wall-clock fired");

    // Drain the first request so we don't leak in test state
    await first.body!.cancel();
  });
});

describe("createRateLimitedFetch", () => {
  it("passes input/init through to the inner fetch unchanged", async () => {
    const bucket = new TokenBucket({ maxConcurrent: 5 });
    const captured: unknown[] = [];
    const inner = async (input: unknown, init: unknown) => {
      captured.push({ input, init });
      return new Response("ok");
    };
    const wrapped = createRateLimitedFetch(inner as unknown as typeof fetch, bucket);

    await wrapped("https://a.test", { method: "POST", body: "x" });
    await wrapped("https://b.test");

    expect(captured).toHaveLength(2);
    expect(captured[0]).toEqual({
      input: "https://a.test",
      init: { method: "POST", body: "x" },
    });
    expect((captured[1] as { input: string }).input).toBe("https://b.test");
  });
});

describe("getProviderBucket", () => {
  beforeEach(() => {
    resetProviderBucketsForTest();
  });

  it("returns the same bucket for the same provider name", () => {
    const a = getProviderBucket("kingxliu", { maxConcurrent: 3 });
    const b = getProviderBucket("kingxliu");
    expect(a).toBe(b);
  });

  it("returns distinct buckets for different provider names", () => {
    const a = getProviderBucket("kingxliu", { maxConcurrent: 3 });
    const b = getProviderBucket("anthropic", { maxConcurrent: 10 });
    expect(a).not.toBe(b);
  });

  it("ignores subsequent option changes — first wins until reset", () => {
    // Caching by name means the first caller's limits stick. This prevents
    // inconsistent configs within a process but requires a reset for tests.
    const first = getProviderBucket("x", { maxConcurrent: 2 });
    const second = getProviderBucket("x", { maxConcurrent: 10 });
    expect(first).toBe(second);
  });

  it("separates buckets by composite key so different models get distinct limits", () => {
    // model-factory uses `${provider}:${model}` for per-model rate limits so
    // kingxliu/gpt-5.4 and kingxliu/MiniMax get independent buckets even
    // though they share a provider account.
    const gpt = getProviderBucket("kingxliu:gpt-5.4", { maxConcurrent: 2 });
    const minimax = getProviderBucket("kingxliu:MiniMax-M2.7-highspeed", {
      maxConcurrent: 8,
    });
    const accountWide = getProviderBucket("kingxliu", { maxConcurrent: 6 });
    expect(gpt).not.toBe(minimax);
    expect(gpt).not.toBe(accountWide);
    expect(minimax).not.toBe(accountWide);
  });
});
