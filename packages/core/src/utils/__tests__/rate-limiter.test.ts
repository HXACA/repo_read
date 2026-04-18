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
