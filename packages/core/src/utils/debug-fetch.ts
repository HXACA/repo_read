/**
 * Logging fetch wrapper for AI SDK debug mode.
 *
 * Wraps the global fetch to intercept every HTTP request/response to LLM APIs.
 * Each request is written to disk immediately, and each response is written
 * as soon as it arrives — before the streaming body is consumed.
 *
 * File layout:
 *   <seq>-request.json    — written BEFORE the HTTP request is sent
 *   <seq>-response.json   — written as soon as response headers arrive
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

let debugDir: string | null = null;
let seq = 0;

export function setDebugDir(dir: string | null): void {
  debugDir = dir;
}

export function getDebugDir(): string | null {
  return debugDir;
}

async function writeDebug(filename: string, data: unknown): Promise<void> {
  if (!debugDir) return;
  try {
    await fs.mkdir(debugDir, { recursive: true });
    await fs.writeFile(path.join(debugDir, filename), JSON.stringify(data, null, 2), "utf-8");
  } catch { /* never break the pipeline */ }
}

/**
 * Create a fetch function that logs request/response to the debug directory.
 * Pass this as the `fetch` option to AI SDK provider constructors.
 */
export function createDebugFetch(): typeof globalThis.fetch {
  return async (input: string | URL | globalThis.Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const n = String(++seq).padStart(4, "0");
    const ts = new Date().toISOString();

    // Parse request body
    let requestBody: unknown = null;
    if (init?.body) {
      try {
        requestBody = JSON.parse(typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body as ArrayBuffer));
      } catch {
        requestBody = typeof init.body === "string" ? init.body : "(binary)";
      }
    }

    // Write request immediately
    await writeDebug(`${n}-request.json`, {
      url,
      method: init?.method ?? "POST",
      body: requestBody,
      timestamp: ts,
    });

    // Execute real fetch
    const start = Date.now();
    let response: Response;
    try {
      response = await globalThis.fetch(input, init);
    } catch (error) {
      await writeDebug(`${n}-error.json`, {
        url,
        error: error instanceof Error ? { message: error.message, name: error.name } : String(error),
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      });
      throw error;
    }

    // For streaming responses, clone and read to capture the body without
    // interfering with the SDK's stream consumption.
    const durationMs = Date.now() - start;
    const status = response.status;
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("event-stream") || contentType.includes("stream")) {
      // SSE / streaming — just log headers, body will be consumed by SDK
      await writeDebug(`${n}-response.json`, {
        url,
        status,
        contentType,
        streaming: true,
        durationMs,
        timestamp: new Date().toISOString(),
      });
    } else {
      // Non-streaming — clone and read full body
      try {
        const clone = response.clone();
        const body = await clone.text();
        let parsed: unknown;
        try { parsed = JSON.parse(body); } catch { parsed = body; }
        await writeDebug(`${n}-response.json`, {
          url,
          status,
          body: parsed,
          durationMs,
          timestamp: new Date().toISOString(),
        });
      } catch {
        await writeDebug(`${n}-response.json`, {
          url,
          status,
          body: "(failed to read)",
          durationMs,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return response;
  };
}
