import { describe, it, expect, vi } from "vitest";
import {
  createResilientFetch,
  createWallClockFetch,
  SSETimeoutError,
  WallClockTimeoutError,
} from "../resilient-fetch.js";

// Helper: build a ReadableStream from an array of chunks with optional stall at the end.
function makeStream(chunks: Uint8Array[], stallAfterChunks = false): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else if (stallAfterChunks) {
        // Stall forever — never close or enqueue
        await new Promise<never>(() => {});
      } else {
        controller.close();
      }
    },
  });
}

describe("createResilientFetch", () => {
  describe("non-streaming passthrough", () => {
    it("returns the original response unchanged for application/json", async () => {
      const body = JSON.stringify({ hello: "world" });
      // Override the null body — use a real JSON response
      const mockFetch2: typeof globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const resilient = createResilientFetch(mockFetch2, { sseReadTimeoutMs: 100 });
      const response = await resilient("https://example.com/api", {});

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");
      const text = await response.text();
      expect(text).toBe(body);
    });

    it("returns the original response for text/html", async () => {
      const mockFetch: typeof globalThis.fetch = vi.fn().mockResolvedValue(
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );
      const resilient = createResilientFetch(mockFetch, { sseReadTimeoutMs: 100 });
      const response = await resilient("https://example.com/", {});

      expect(response.headers.get("content-type")).toBe("text/html");
      const text = await response.text();
      expect(text).toBe("<html></html>");
    });
  });

  describe("normal streaming works", () => {
    it("passes through all chunks when data arrives within timeout", async () => {
      const encoder = new TextEncoder();
      const chunks = [
        encoder.encode("data: chunk1\n\n"),
        encoder.encode("data: chunk2\n\n"),
        encoder.encode("data: chunk3\n\n"),
      ];
      const stream = makeStream(chunks, false);

      const mockFetch: typeof globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );

      const resilient = createResilientFetch(mockFetch, { sseReadTimeoutMs: 5_000 });
      const response = await resilient("https://example.com/stream", {});

      expect(response.headers.get("content-type")).toBe("text/event-stream");

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const received: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received.push(decoder.decode(value));
      }

      expect(received).toHaveLength(3);
      expect(received[0]).toBe("data: chunk1\n\n");
      expect(received[1]).toBe("data: chunk2\n\n");
      expect(received[2]).toBe("data: chunk3\n\n");
    });

    it("preserves status and headers on streaming response", async () => {
      const encoder = new TextEncoder();
      const stream = makeStream([encoder.encode("data: ok\n\n")], false);

      const mockFetch: typeof globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 206,
          headers: {
            "content-type": "text/event-stream",
            "x-custom-header": "preserved",
          },
        }),
      );

      const resilient = createResilientFetch(mockFetch, { sseReadTimeoutMs: 5_000 });
      const response = await resilient("https://example.com/stream", {});

      expect(response.status).toBe(206);
      expect(response.headers.get("x-custom-header")).toBe("preserved");
    });
  });

  describe("SSE timeout triggers", () => {
    it("rejects with SSETimeoutError when stream stalls after first chunk", async () => {
      const encoder = new TextEncoder();
      // One chunk is delivered, then the stream stalls indefinitely
      const chunks = [encoder.encode("data: first\n\n")];
      const stream = makeStream(chunks, true /* stall after */);

      const mockFetch: typeof globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );

      // Use a very short timeout (50ms) with real timers
      const resilient = createResilientFetch(mockFetch, { sseReadTimeoutMs: 50 });
      const response = await resilient("https://example.com/stream", {});

      const reader = response.body!.getReader();

      // First chunk should arrive fine
      const first = await reader.read();
      expect(first.done).toBe(false);
      expect(new TextDecoder().decode(first.value)).toBe("data: first\n\n");

      // Second read will stall — timeout fires after 50ms
      await expect(reader.read()).rejects.toBeInstanceOf(SSETimeoutError);
    }, 2000);

    it("rejects when stream never sends data", async () => {
      // Stream that stalls from the very first read
      const stream = makeStream([], true /* stall immediately */);

      const mockFetch: typeof globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );

      // Use a very short timeout (50ms) with real timers
      const resilient = createResilientFetch(mockFetch, { sseReadTimeoutMs: 50 });
      const response = await resilient("https://example.com/stream", {});

      const reader = response.body!.getReader();
      await expect(reader.read()).rejects.toBeInstanceOf(SSETimeoutError);
    }, 2000);

    it("SSETimeoutError has correct name and message", () => {
      const err = new SSETimeoutError(3000);
      expect(err.name).toBe("SSETimeoutError");
      expect(err.message).toContain("3000ms");
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe("application/octet-stream passthrough", () => {
    it("wraps octet-stream body with timeout (it is a stream content-type)", async () => {
      // application/octet-stream includes 'stream', so it should be wrapped
      const encoder = new TextEncoder();
      const stream = makeStream([encoder.encode("binary-data")], false);

      const mockFetch: typeof globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
      );

      const resilient = createResilientFetch(mockFetch, { sseReadTimeoutMs: 5_000 });
      const response = await resilient("https://example.com/binary", {});

      // Should still work — just wrapped
      const reader = response.body!.getReader();
      const { value, done } = await reader.read();
      expect(done).toBe(false);
      expect(new TextDecoder().decode(value)).toBe("binary-data");
    });
  });
});

describe("createWallClockFetch", () => {
  it("returns the response when the body completes before the deadline", async () => {
    const inner: typeof globalThis.fetch = async () =>
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    const wrapped = createWallClockFetch(inner, { timeoutMs: 5_000 });
    const res = await wrapped("https://a.test");
    expect(await res.text()).toBe("ok");
  });

  it("aborts the underlying fetch when the timeout fires before response", async () => {
    // Inner fetch hangs forever, then respects abort to reject
    const inner: typeof globalThis.fetch = (_input, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      });
    const wrapped = createWallClockFetch(inner, { timeoutMs: 40 });
    await expect(wrapped("https://slow.test")).rejects.toBeInstanceOf(WallClockTimeoutError);
  });

  it("aborts a slow-drip stream that never completes reading", async () => {
    // Body pull() never enqueues AND never respects abort via close, but we
    // wire abort on the upstream signal to propagate to the body's pull loop.
    const inner: typeof globalThis.fetch = (_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => reject(init!.signal!.reason);
            init!.signal!.addEventListener("abort", onAbort, { once: true });
            // Never resolve naturally — only abort unsticks us
          });
          controller.close();
        },
      });
      return Promise.resolve(
        new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
      );
    };
    const wrapped = createWallClockFetch(inner, { timeoutMs: 40 });
    const res = await wrapped("https://drip.test");
    const reader = res.body!.getReader();
    await expect(reader.read()).rejects.toBeDefined();
  });

  it("propagates the caller's AbortSignal so external cancel still works", async () => {
    const inner: typeof globalThis.fetch = (_input, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted by caller")), { once: true });
      });
    const wrapped = createWallClockFetch(inner, { timeoutMs: 5_000 });
    const caller = new AbortController();
    setTimeout(() => caller.abort(new Error("caller cancel")), 30);
    await expect(wrapped("https://a.test", { signal: caller.signal })).rejects.toThrow("aborted by caller");
  });

  it("clears the timer once the body is consumed — no stray abort for later requests", async () => {
    let lastSignal: AbortSignal | undefined;
    const inner: typeof globalThis.fetch = (_input, init) => {
      lastSignal = init?.signal ?? undefined;
      return Promise.resolve(
        new Response("done", { status: 200, headers: { "content-type": "text/plain" } }),
      );
    };
    const wrapped = createWallClockFetch(inner, { timeoutMs: 50 });
    const res = await wrapped("https://a.test");
    await res.text();
    // After consumption, waiting past the original timeout should NOT flip aborted
    await new Promise((r) => setTimeout(r, 80));
    expect(lastSignal?.aborted).toBe(false);
  });

  describe("wakeSignal integration", () => {
    it("aborts an in-flight fetch when the wakeSignal fires", async () => {
      const inner: typeof globalThis.fetch = (_input, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
        });
      const wakeController = new AbortController();
      const wrapped = createWallClockFetch(inner, {
        timeoutMs: 60_000, // long — wakeSignal fires first
        wakeSignal: () => wakeController.signal,
      });
      setTimeout(() => wakeController.abort(new Error("woke up")), 30);
      await expect(wrapped("https://hang.test")).rejects.toThrow(/woke up/);
    });

    it("reads wakeSignal per-call so rotated signals are picked up", async () => {
      // Simulates Diagnostics rotating its controller after each wake event:
      // first call subscribes to v1 (which is pre-aborted), second call must
      // see the fresh v2 signal (not-aborted).
      const v1 = new AbortController();
      v1.abort(new Error("stale"));
      const v2 = new AbortController();
      let callIdx = 0;
      const signals = [v1.signal, v2.signal];
      const inner: typeof globalThis.fetch = async () =>
        new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
      const wrapped = createWallClockFetch(inner, {
        timeoutMs: 5_000,
        wakeSignal: () => signals[callIdx++]!,
      });
      // First call picks signals[0] (already aborted) → should reject
      await expect(wrapped("https://a.test")).rejects.toThrow(/stale/);
      // Second call picks signals[1] (clean) → must succeed
      const res = await wrapped("https://a.test");
      expect(await res.text()).toBe("ok");
    });

    it("does not affect fetches that completed before the wake fires", async () => {
      const wakeController = new AbortController();
      const inner: typeof globalThis.fetch = async () =>
        new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
      const wrapped = createWallClockFetch(inner, {
        timeoutMs: 5_000,
        wakeSignal: () => wakeController.signal,
      });
      const res = await wrapped("https://fast.test");
      const body = await res.text();
      expect(body).toBe("ok");
      // Wake AFTER the fetch already finished — must not throw.
      wakeController.abort(new Error("late wake"));
    });
  });
});
