/**
 * Logging fetch wrapper for AI SDK debug mode.
 *
 * Each HTTP call = one file: <timestamp>-<rand>.json
 * Streaming responses are reassembled into a complete non-streaming response
 * object (content + tool_calls + usage merged from SSE deltas).
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

/** Parse SSE lines and merge deltas into a single non-streaming response. */
function assembleStreamResponse(raw: string): unknown {
  const lines = raw.split("\n");
  let content = "";
  let role = "assistant";
  const toolCalls: Map<number, { id: string; type: string; function: { name: string; arguments: string } }> = new Map();
  let usage: unknown = null;
  let model = "";
  let finishReason = "";

  for (const line of lines) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    let chunk: any;
    try { chunk = JSON.parse(line.slice(6)); } catch { continue; }

    if (chunk.model) model = chunk.model;
    if (chunk.usage) usage = chunk.usage;

    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finishReason = choice.finish_reason;

    const delta = choice.delta;
    if (!delta) continue;
    if (delta.role) role = delta.role;
    if (delta.content) content += delta.content;

    // Accumulate tool calls by index
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const existing = toolCalls.get(idx);
        if (!existing) {
          toolCalls.set(idx, {
            id: tc.id ?? "",
            type: tc.type ?? "function",
            function: { name: tc.function?.name ?? "", arguments: tc.function?.arguments ?? "" },
          });
        } else {
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.function.name += tc.function.name;
          if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
        }
      }
    }
  }

  const message: Record<string, unknown> = { role, content };
  if (toolCalls.size > 0) {
    message.tool_calls = Array.from(toolCalls.entries())
      .sort(([a], [b]) => a - b)
      .map(([, v]) => v);
  }

  return {
    model,
    choices: [{ message, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  };
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
      // Non-streaming: read full body
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

    // Streaming: clone the response so SDK gets the original untouched stream,
    // and we read the clone in the background for debug logging.
    const clone = response.clone();
    // Write partial log immediately (request + status), then update with body when stream ends
    record.response = "(streaming — reading in background)";
    record.durationMs = Date.now() - start;
    record.responseAt = new Date().toISOString();
    await writeJson(filePath, record);

    // Read the clone in the background — doesn't block the SDK
    clone.text().then((raw) => {
      try { record.response = assembleStreamResponse(raw); } catch { record.response = raw; }
      record.durationMs = Date.now() - start;
      record.responseAt = new Date().toISOString();
      writeJson(filePath, record);
    }).catch(() => { /* ignore clone read errors */ });

    return response;
  };
}
