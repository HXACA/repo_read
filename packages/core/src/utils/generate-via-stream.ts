/**
 * Streaming-compatible wrapper around AI SDK's text generation.
 *
 * Debug mode: call `setDebugDir(path)` to enable. Writes:
 *   <seq>-request.json    — before LLM call
 *   <seq>-response.json   — after completion (includes all steps)
 *   <seq>-ERROR.json      — on failure
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { streamText } from "ai";

type StreamTextParams = Parameters<typeof streamText>[0];

export type GenerateViaStreamResult = {
  text: string;
  finishReason: string;
  usage: Record<string, unknown>;
  toolCalls: unknown[];
  toolResults: unknown[];
  steps: unknown[];
};

let callSeq = 0;
let debugDir: string | null = null;

export function setDebugDir(dir: string | null): void {
  debugDir = dir;
  callSeq = 0;
}

function getModelId(params: StreamTextParams): string {
  if (!params.model) return "unknown";
  const m = params.model as Record<string, unknown>;
  return String(m.modelId ?? m.id ?? params.model);
}

function serializeTools(tools: unknown): unknown {
  if (!tools || typeof tools !== "object") return undefined;
  const result: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(tools as Record<string, unknown>)) {
    if (!def || typeof def !== "object") { result[name] = def; continue; }
    const d = def as Record<string, unknown>;
    result[name] = { description: d.description, inputSchema: d.inputSchema ?? d.parameters };
  }
  return result;
}

async function writeDebug(filename: string, data: unknown): Promise<void> {
  if (!debugDir) return;
  try {
    await fs.mkdir(debugDir, { recursive: true });
    await fs.writeFile(path.join(debugDir, filename), JSON.stringify(data, null, 2), "utf-8");
  } catch { /* never break the pipeline */ }
}

export async function generateViaStream(
  params: StreamTextParams,
): Promise<GenerateViaStreamResult> {
  const debug = debugDir !== null;
  const start = debug ? Date.now() : 0;
  const seq = debug ? String(++callSeq).padStart(4, "0") : "";

  // Write request BEFORE the LLM call
  if (debug) {
    await writeDebug(`${seq}-request.json`, {
      modelId: getModelId(params),
      system: params.system,
      prompt: params.prompt,
      messages: params.messages,
      tools: serializeTools(params.tools),
      timestamp: new Date().toISOString(),
    });
  }

  let result: GenerateViaStreamResult;
  try {
    const stream = streamText(params);

    const text = await stream.text;
    const finishReason = (await stream.finishReason) ?? "stop";
    const usage = (await stream.usage) ?? {};
    const toolCalls = (await stream.toolCalls) ?? [];
    const toolResults = (await stream.toolResults) ?? [];
    const steps = (await stream.steps) ?? [];

    result = { text, finishReason, usage, toolCalls, toolResults, steps };
  } catch (error) {
    if (debug) {
      const err = error instanceof Error ? error : new Error(String(error));
      await writeDebug(`${seq}-ERROR.json`, {
        error: { message: err.message, name: err.name, statusCode: (err as any).statusCode, responseBody: (err as any).responseBody },
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      });
    }
    throw error;
  }

  // Write full response with all steps
  if (debug) {
    await writeDebug(`${seq}-response.json`, {
      text: result.text,
      finishReason: result.finishReason,
      usage: result.usage,
      toolCalls: result.toolCalls,
      toolResults: result.toolResults,
      steps: result.steps,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  }

  return result;
}
