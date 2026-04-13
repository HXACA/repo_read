import { describe, it, expect, vi } from "vitest";
import { createResilientFetch, SSETimeoutError } from "../resilient-fetch.js";

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

// Helper: build a mock fetch that returns a Response with the given content-type and body stream.
function makeMockFetch(
  contentType: string,
  body: ReadableStream<Uint8Array> | null,
  status = 200,
): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue(
    new Response(body, {
      status,
      headers: { "content-type": contentType },
    }),
  );
}

describe("createResilientFetch", () => {
  describe("non-streaming passthrough", () => {
    it("returns the original response unchanged for application/json", async () => {
      const body = JSON.stringify({ hello: "world" });
      const mockFetch = makeMockFetch("application/json", null);
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
