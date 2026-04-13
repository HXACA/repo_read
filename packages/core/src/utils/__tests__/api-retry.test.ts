import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyApiError, withRetry } from "../api-retry.js";
import { SSETimeoutError } from "../resilient-fetch.js";

// Helper: build a fake AI SDK error with a statusCode and optional headers/body.
function makeApiError(
  statusCode: number,
  {
    responseBody = "",
    responseHeaders,
  }: {
    responseBody?: string;
    responseHeaders?: Record<string, string>;
  } = {},
): unknown {
  const err = new Error(`API error ${statusCode}`) as any;
  err.statusCode = statusCode;
  err.responseBody = responseBody;
  err.responseHeaders = responseHeaders ?? {};
  return err;
}

// ─────────────────────────────────────────────────────────────────────────────
// classifyApiError
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyApiError", () => {
  it("classifies 429 as rate_limit + retryable", () => {
    const result = classifyApiError(makeApiError(429));
    expect(result.kind).toBe("rate_limit");
    expect(result.retryable).toBe(true);
  });

  it("classifies 529 as server_overload + retryable", () => {
    const result = classifyApiError(makeApiError(529));
    expect(result.kind).toBe("server_overload");
    expect(result.retryable).toBe(true);
  });

  it("classifies 503 as server_overload + retryable", () => {
    const result = classifyApiError(makeApiError(503));
    expect(result.kind).toBe("server_overload");
    expect(result.retryable).toBe(true);
  });

  it("classifies 500 as server_error + retryable", () => {
    const result = classifyApiError(makeApiError(500));
    expect(result.kind).toBe("server_error");
    expect(result.retryable).toBe(true);
  });

  it("classifies 502 as server_error + retryable", () => {
    const result = classifyApiError(makeApiError(502));
    expect(result.kind).toBe("server_error");
    expect(result.retryable).toBe(true);
  });

  it("classifies 401 as auth_error + NOT retryable", () => {
    const result = classifyApiError(makeApiError(401));
    expect(result.kind).toBe("auth_error");
    expect(result.retryable).toBe(false);
  });

  it("classifies 403 as auth_error + NOT retryable", () => {
    const result = classifyApiError(makeApiError(403));
    expect(result.kind).toBe("auth_error");
    expect(result.retryable).toBe(false);
  });

  it("classifies 400 + 'prompt is too long' as context_overflow + NOT retryable", () => {
    const result = classifyApiError(
      makeApiError(400, { responseBody: "This request failed: prompt is too long" }),
    );
    expect(result.kind).toBe("context_overflow");
    expect(result.retryable).toBe(false);
  });

  it("classifies 400 + 'context_length_exceeded' as context_overflow + NOT retryable", () => {
    const result = classifyApiError(
      makeApiError(400, { responseBody: "context_length_exceeded for this model" }),
    );
    expect(result.kind).toBe("context_overflow");
    expect(result.retryable).toBe(false);
  });

  it("classifies 400 + 'maximum context length' as context_overflow + NOT retryable", () => {
    const result = classifyApiError(
      makeApiError(400, {
        responseBody: "This model's maximum context length is 8192 tokens",
      }),
    );
    expect(result.kind).toBe("context_overflow");
    expect(result.retryable).toBe(false);
  });

  it("classifies 400 without overflow keywords as bad_request + NOT retryable", () => {
    const result = classifyApiError(
      makeApiError(400, { responseBody: "Invalid parameter: temperature must be <= 2" }),
    );
    expect(result.kind).toBe("bad_request");
    expect(result.retryable).toBe(false);
  });

  it("classifies SSETimeoutError as timeout + retryable", () => {
    const result = classifyApiError(new SSETimeoutError(30_000));
    expect(result.kind).toBe("timeout");
    expect(result.retryable).toBe(true);
  });

  it("classifies unknown errors as unknown + NOT retryable", () => {
    const result = classifyApiError(new Error("network failure"));
    expect(result.kind).toBe("unknown");
    expect(result.retryable).toBe(false);
  });

  it("classifies non-Error unknowns as unknown + NOT retryable", () => {
    const result = classifyApiError("some string error");
    expect(result.kind).toBe("unknown");
    expect(result.retryable).toBe(false);
  });

  // ── retry-after header parsing ──────────────────────────────────────────

  it("parses retry-after header in seconds for 429", () => {
    const result = classifyApiError(
      makeApiError(429, { responseHeaders: { "retry-after": "30" } }),
    );
    expect(result.kind).toBe("rate_limit");
    expect(result.retryAfterMs).toBe(30_000);
  });

  it("parses retry-after-ms header (ms variant) for 429", () => {
    const result = classifyApiError(
      makeApiError(429, { responseHeaders: { "retry-after-ms": "5000" } }),
    );
    expect(result.kind).toBe("rate_limit");
    expect(result.retryAfterMs).toBe(5_000);
  });

  it("prefers retry-after-ms over retry-after when both are present", () => {
    const result = classifyApiError(
      makeApiError(429, {
        responseHeaders: { "retry-after": "60", "retry-after-ms": "2500" },
      }),
    );
    expect(result.retryAfterMs).toBe(2_500);
  });

  it("returns undefined retryAfterMs when no retry-after header is present", () => {
    const result = classifyApiError(makeApiError(429));
    expect(result.retryAfterMs).toBeUndefined();
  });

  it("parses retry-after header for 529 (server_overload)", () => {
    const result = classifyApiError(
      makeApiError(529, { responseHeaders: { "retry-after": "10" } }),
    );
    expect(result.kind).toBe("server_overload");
    expect(result.retryAfterMs).toBe(10_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withRetry
// ─────────────────────────────────────────────────────────────────────────────

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the result immediately when fn succeeds on first try", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    // No timers needed — resolve immediately
    const result = await promise;
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on a retryable error and succeeds on second attempt", async () => {
    const retryableErr = makeApiError(500);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(retryableErr)
      .mockResolvedValue("ok");

    const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 10, backoffFactor: 2 });
    // Advance past the first retry delay (10ms * 2^0 = 10ms)
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a non-retryable error (auth_error)", async () => {
    const authErr = makeApiError(401);
    const fn = vi.fn().mockRejectedValue(authErr);

    await expect(
      withRetry(fn, { maxRetries: 3, baseDelayMs: 10 }),
    ).rejects.toBe(authErr);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a context_overflow (400 with overflow body)", async () => {
    const overflowErr = makeApiError(400, {
      responseBody: "prompt is too long",
    });
    const fn = vi.fn().mockRejectedValue(overflowErr);

    await expect(
      withRetry(fn, { maxRetries: 3, baseDelayMs: 10 }),
    ).rejects.toBe(overflowErr);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxRetries and throws the last error", async () => {
    const serverErr = makeApiError(500);
    const fn = vi.fn().mockRejectedValue(serverErr);

    // Attach a no-op .catch immediately to avoid unhandled rejection warnings
    // while fake timers drive the retries asynchronously.
    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 10, backoffFactor: 2 });
    promise.catch(() => {});

    // attempt 0 fails → wait 10ms (10 * 2^0)
    await vi.advanceTimersByTimeAsync(10);
    // attempt 1 fails → wait 20ms (10 * 2^1)
    await vi.advanceTimersByTimeAsync(20);
    // attempt 2 (final) fails → throw

    await expect(promise).rejects.toBe(serverErr);
    // Called: attempt 0 + 1 + 2 = 3 times total (maxRetries=2 means 2 retries + 1 initial)
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects retry-after delay from error header", async () => {
    const rateLimitErr = makeApiError(429, {
      responseHeaders: { "retry-after": "1" }, // 1 second = 1000ms
    });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValue("done");

    const promise = withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 50, // baseDelay is smaller; retry-after should win
      backoffFactor: 2,
    });

    // Advance by less than the retry-after delay — should not have retried yet
    await vi.advanceTimersByTimeAsync(500);
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance past the retry-after delay (1000ms total)
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;
    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("applies exponential backoff without retry-after header", async () => {
    const serverErr = makeApiError(502);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(serverErr) // attempt 0: wait 20ms (20*2^0)
      .mockRejectedValueOnce(serverErr) // attempt 1: wait 40ms (20*2^1)
      .mockResolvedValue("recovered");

    const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 20, backoffFactor: 2 });

    await vi.advanceTimersByTimeAsync(20); // first retry fires
    await vi.advanceTimersByTimeAsync(40); // second retry fires

    const result = await promise;
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("defaults to maxRetries=3, baseDelayMs=1000, backoffFactor=2 when no options given", async () => {
    // Just verifying it doesn't throw with defaults (will use real small errors)
    const fn = vi.fn().mockResolvedValue(42);
    const result = await withRetry(fn);
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
