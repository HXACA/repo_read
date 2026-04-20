import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createDebugFetch, setDebugDir } from "../debug-fetch.js";
import { createResilientFetch } from "../resilient-fetch.js";

function makeResponsesApiSseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
      } else {
        controller.close();
      }
    },
  });
}

async function waitForDebugRecord(
  dir: string,
  predicate: (record: Record<string, unknown>) => boolean,
  timeoutMs = 3_000,
): Promise<Record<string, unknown>> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const files = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
    for (const file of files) {
      const raw = await fs.readFile(path.join(dir, file), "utf8");
      // debug-fetch writes async — we may observe a file that's been
      // created but not yet fully flushed. Skip unparseable partial writes
      // and re-check on the next poll cycle instead of throwing.
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (predicate(record)) return record;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Timed out waiting for debug record");
}

describe("createDebugFetch + createResilientFetch", () => {
  let tmpDir: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "debug-fetch-test-"));
    originalFetch = globalThis.fetch;
    setDebugDir(tmpDir);
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    setDebugDir(null);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("keeps the SDK stream readable while debug logging assembles a large streaming response", async () => {
    const contentChunk = "x".repeat(2048);
    const contentChunks = Array.from({ length: 128 }, () => contentChunk);
    const expectedContent = contentChunks.join("");
    const sseChunks: string[] = [];

    for (const chunk of contentChunks) {
      sseChunks.push(
        `event: response.output_text.delta\n` +
          `data: ${JSON.stringify({ type: "response.output_text.delta", delta: chunk })}\n\n`,
      );
    }
    sseChunks.push(
      `event: response.completed\n` +
        `data: ${JSON.stringify({
          type: "response.completed",
          response: {
            model: "gpt-5.4",
            usage: {
              input_tokens: 1000,
              input_tokens_details: { cached_tokens: 500 },
              output_tokens: 256,
              output_tokens_details: { reasoning_tokens: 0 },
              total_tokens: 1256,
            },
          },
        })}\n\n`,
    );

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeResponsesApiSseStream(sseChunks), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const debugFetch = createDebugFetch();
    const resilientFetch = createResilientFetch(debugFetch, {
      sseReadTimeoutMs: 5_000,
    });

    const response = await resilientFetch("https://example.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.4", stream: true }),
    });

    const rawSse = await response.text();
    expect(rawSse).toContain("response.output_text.delta");
    expect(rawSse).toContain("response.completed");

    const record = await waitForDebugRecord(
      tmpDir,
      (value) => typeof value.responseAt === "string" && typeof value.durationMs === "number",
    );

    expect(record.status).toBe(200);
    const assembled = record.response as {
      model?: string;
      message?: { content?: string };
      usage?: { input_tokens?: number };
    };
    expect(assembled.model).toBe("gpt-5.4");
    expect(assembled.message?.content).toHaveLength(expectedContent.length);
    expect(assembled.message?.content).toBe(expectedContent);
    expect(assembled.usage?.input_tokens).toBe(1000);
  });

  it("still logs non-streaming responses completely", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, mode: "json" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const debugFetch = createDebugFetch();
    const response = await debugFetch("https://example.com/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ping: true }),
    });

    expect(await response.json()).toEqual({ ok: true, mode: "json" });

    const record = await waitForDebugRecord(
      tmpDir,
      (value) => typeof value.responseAt === "string" && typeof value.durationMs === "number",
    );

    expect(record.status).toBe(200);
    expect(record.response).toEqual({ ok: true, mode: "json" });
  });
});
