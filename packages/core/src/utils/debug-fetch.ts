/**
 * Logging fetch wrapper for AI SDK debug mode.
 *
 * Each HTTP request produces ONE file: <timestamp>.json
 * Written in two phases:
 *   1. Request sent → file created with request data
 *   2. Response received → file overwritten with request + response
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

    // Write request immediately
    const record: Record<string, unknown> = {
      url,
      method: init?.method ?? "POST",
      request: requestBody,
      requestAt: new Date().toISOString(),
    };
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

    // Capture response
    record.status = response.status;
    record.durationMs = Date.now() - start;
    record.responseAt = new Date().toISOString();

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("event-stream") || contentType.includes("stream")) {
      record.response = "(streaming)";
    } else {
      try {
        const clone = response.clone();
        const body = await clone.text();
        try { record.response = JSON.parse(body); } catch { record.response = body; }
      } catch {
        record.response = "(failed to read)";
      }
    }

    await writeJson(filePath, record);
    return response;
  };
}
