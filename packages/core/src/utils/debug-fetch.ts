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

/** Parse SSE and assemble into a single response. Supports Responses API, Chat Completions, and Anthropic Messages formats. */
function assembleStreamResponse(raw: string): unknown {
  const lines = raw.split("\n");

  // Detect format from event types
  const isResponsesApi = lines.some((l) => l.startsWith("event: response."));
  const isAnthropic = lines.some((l) => l.startsWith("event: message_start") || l.startsWith("event: content_block_delta"));

  if (isResponsesApi) return assembleResponsesApi(lines);
  if (isAnthropic) return assembleAnthropicMessages(lines);
  return assembleChatCompletions(lines);
}

/** Assemble OpenAI Responses API SSE events. */
function assembleResponsesApi(lines: string[]): unknown {
  let content = "";
  let model = "";
  let usage: unknown = null;
  const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
  let currentToolArgs = "";
  let currentToolName = "";
  let currentToolId = "";

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SSE event shapes vary by API format
    let data: any;
    try { data = JSON.parse(line.slice(6)); } catch { continue; }

    const type = data.type;

    if (type === "response.completed" && data.response) {
      model = data.response.model ?? model;
      usage = data.response.usage ?? usage;
    }

    // Text content
    if (type === "response.output_text.delta") {
      content += data.delta ?? "";
    }

    // Tool calls
    if (type === "response.function_call_arguments.delta") {
      currentToolArgs += data.delta ?? "";
    }
    if (type === "response.output_item.added" && data.item?.type === "function_call") {
      currentToolName = data.item.name ?? "";
      currentToolId = data.item.call_id ?? data.item.id ?? "";
      currentToolArgs = "";
    }
    if (type === "response.output_item.done" && data.item?.type === "function_call") {
      toolCalls.push({ id: currentToolId, name: currentToolName, arguments: currentToolArgs });
      currentToolArgs = "";
    }
  }

  const message: Record<string, unknown> = { role: "assistant", content };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((tc) => ({
      id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments },
    }));
  }

  return { model, message, ...(usage ? { usage } : {}) };
}

/** Assemble Anthropic Messages API SSE events (event: message_start/content_block_delta/message_stop). */
function assembleAnthropicMessages(lines: string[]): unknown {
  let content = "";
  let model = "";
  let usage: unknown = null;
  let stopReason = "";
  const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
  let currentToolId = "";
  let currentToolName = "";
  let currentToolArgs = "";

  let currentEvent = "";
  for (const line of lines) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
      continue;
    }
    if (!line.startsWith("data: ")) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SSE event shapes vary by API format
    let data: any;
    try { data = JSON.parse(line.slice(6)); } catch { continue; }

    if (currentEvent === "message_start" && data.message) {
      model = data.message.model ?? model;
      if (data.message.usage) usage = data.message.usage;
    }
    if (currentEvent === "content_block_delta" && data.delta) {
      if (data.delta.type === "text_delta") {
        content += data.delta.text ?? "";
      } else if (data.delta.type === "input_json_delta") {
        currentToolArgs += data.delta.partial_json ?? "";
      }
    }
    if (currentEvent === "content_block_start" && data.content_block) {
      if (data.content_block.type === "tool_use") {
        currentToolId = data.content_block.id ?? "";
        currentToolName = data.content_block.name ?? "";
        currentToolArgs = "";
      }
    }
    if (currentEvent === "content_block_stop") {
      if (currentToolName) {
        toolCalls.push({ id: currentToolId, name: currentToolName, arguments: currentToolArgs });
        currentToolName = "";
        currentToolArgs = "";
      }
    }
    if (currentEvent === "message_delta" && data.delta) {
      stopReason = data.delta.stop_reason ?? stopReason;
      if (data.usage) usage = { ...(usage as Record<string, unknown> ?? {}), ...data.usage };
    }
  }

  const message: Record<string, unknown> = { role: "assistant", content };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((tc) => ({
      id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments },
    }));
  }

  return { model, message, ...(usage ? { usage } : {}), stop_reason: stopReason };
}

/** Assemble Chat Completions SSE events (data: {"choices":[{"delta":...}]}). */
function assembleChatCompletions(lines: string[]): unknown {
  let content = "";
  let role = "assistant";
  const toolCalls: Map<number, { id: string; type: string; function: { name: string; arguments: string } }> = new Map();
  let usage: unknown = null;
  let model = "";
  let finishReason = "";

  for (const line of lines) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Chat Completions SSE chunk shape
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

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const existing = toolCalls.get(idx);
        if (!existing) {
          toolCalls.set(idx, {
            id: tc.id ?? "", type: tc.type ?? "function",
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

  return { model, choices: [{ message, finish_reason: finishReason }], ...(usage ? { usage } : {}) };
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

    // Streaming: tee the body so debug logging reads one branch and the
    // SDK reads the other. response.clone() is unsafe here — clone and
    // original share the same underlying TCP stream, causing data loss
    // under concurrent reads (especially with large payloads 300KB+).
    const [sdkBranch, debugBranch] = response.body.tee();

    // Background: read debug branch and assemble SSE
    const debugReader = new Response(debugBranch);
    debugReader.text().then((raw) => {
      try { record.response = assembleStreamResponse(raw); } catch { record.response = raw; }
      record.durationMs = Date.now() - start;
      record.responseAt = new Date().toISOString();
      writeJson(filePath, record);
    }).catch(() => { /* ignore debug read errors */ });

    // Return a new Response with the SDK branch — completely independent
    return new Response(sdkBranch, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
