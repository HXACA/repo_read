/**
 * Logging fetch wrapper for AI SDK debug mode.
 *
 * Each HTTP call = one file: <timestamp>-<rand>.json
 *   1. Request sent → file created with request data
 *   2. Response complete → file overwritten with request + full response
 *
 * For streaming (SSE) responses, the body is collected as it flows through
 * to the SDK, then the complete body is written when the stream ends.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

let debugDir: string | null = null;

export function setDebugDir(dir: string | null): void {
  debugDir = dir;
}

export function getDebugDir(): string | null {
  return debugDir;
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch { /* never break the pipeline */ }
}

export function createDebugFetch(): typeof globalThis.fetch {
  return async (input: string | URL | globalThis.Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const rand = Math.random().toString(36).slice(2, 6);
    const filePath = path.join(debugDir!, `${ts}-${rand}.json`);

    // Parse request body
    let requestBody: unknown = null;
    if (init?.body) {
      try {
        requestBody = JSON.parse(typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body as ArrayBuffer));
      } catch {
        requestBody = typeof init.body === "string" ? init.body : "(binary)";
      }
    }

    const record: Record<string, unknown> = {
      url,
      method: init?.method ?? "POST",
      request: requestBody,
      requestAt: new Date().toISOString(),
    };

    // Write request immediately
    await writeJson(filePath, record);

    // Execute real fetch
    const start = Date.now();
    let response: Response;
    try {
      response = await globalThis.fetch(input, init);
    } catch (error) {
      record.error = error instanceof Error ? { message: error.message, name: error.name } : String(error);
      record.durationMs = Date.now() - start;
      record.responseAt = new Date().toISOString();
      await writeJson(filePath, record);
      throw error;
    }

    record.status = response.status;
    const contentType = response.headers.get("content-type") ?? "";
    const isStreaming = contentType.includes("event-stream") || contentType.includes("stream");

    if (!isStreaming || !response.body) {
      // Non-streaming: read full body immediately
      try {
        const clone = response.clone();
        const body = await clone.text();
        try { record.response = JSON.parse(body); } catch { record.response = body; }
      } catch {
        record.response = "(failed to read)";
      }
      record.durationMs = Date.now() - start;
      record.responseAt = new Date().toISOString();
      await writeJson(filePath, record);
      return response;
    }

    // Streaming: pipe through a TransformStream that collects chunks,
    // then writes the complete body when the stream ends.
    const chunks: string[] = [];
    const decoder = new TextDecoder();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        chunks.push(decoder.decode(chunk, { stream: true }));
        controller.enqueue(chunk);
      },
      flush() {
        // Stream ended — write the complete response (fire-and-forget)
        const fullBody = chunks.join("");
        record.response = fullBody;
        record.durationMs = Date.now() - start;
        record.responseAt = new Date().toISOString();
        writeJson(filePath, record);
      },
    });

    response.body.pipeTo(writable).catch(() => {
      // Stream error — still write what we have
      record.response = chunks.join("") || "(stream error)";
      record.durationMs = Date.now() - start;
      record.responseAt = new Date().toISOString();
      writeJson(filePath, record);
    });

    return new Response(readable, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
