/**
 * Streaming-compatible wrapper around AI SDK's text generation.
 *
 * Debug mode: call `setDebugDir(path)` to enable. Each LLM round-trip
 * (step) is written to its own file **as soon as it completes**, so even
 * if the pipeline crashes mid-run the earlier steps are already on disk.
 *
 * File layout per generateViaStream call:
 *   <callSeq>-request.json           — initial request params (written before first step)
 *   <callSeq>-step-<stepN>.json      — one per step (tool calls + results)
 *   <callSeq>-response.json          — final aggregated result
 *   <callSeq>-ERROR.json             — on failure
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

/** Set the directory where debug logs will be written. Call once per job. */
export function setDebugDir(dir: string | null): void {
  debugDir = dir;
  callSeq = 0;
}

function isDebug(): boolean {
  return debugDir !== null;
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
    result[name] = {
      description: d.description,
      inputSchema: d.inputSchema ?? d.parameters,
    };
  }
  return result;
}

async function writeFile(filename: string, data: unknown): Promise<void> {
  if (!debugDir) return;
  try {
    await fs.mkdir(debugDir, { recursive: true });
    await fs.writeFile(path.join(debugDir, filename), JSON.stringify(data, null, 2), "utf-8");
  } catch { /* never break the pipeline */ }
}

export async function generateViaStream(
  params: StreamTextParams,
): Promise<GenerateViaStreamResult> {
  const debug = isDebug();
  const start = debug ? Date.now() : 0;
  const prefix = debug ? String(++callSeq).padStart(4, "0") : "";

  // Write request params immediately (before any LLM call)
  if (debug) {
    await writeFile(`${prefix}-request.json`, {
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

    // Consume fullStream to capture steps in real-time
    if (debug) {
      let stepN = 0;
      const stepBuffer: unknown[] = [];

      for await (const event of stream.fullStream) {
        stepBuffer.push(event);
        if (event.type === "step-finish") {
          stepN++;
          // Write this step immediately
          await writeFile(`${prefix}-step-${String(stepN).padStart(3, "0")}.json`, {
            step: stepN,
            finishReason: (event as any).finishReason,
            usage: (event as any).usage,
            events: stepBuffer.splice(0),
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

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
      await writeFile(`${prefix}-ERROR.json`, {
        error: {
          message: err.message,
          name: err.name,
          statusCode: (err as any).statusCode,
          responseBody: (err as any).responseBody,
        },
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      });
    }
    throw error;
  }

  // Write final aggregated response
  if (debug) {
    await writeFile(`${prefix}-response.json`, {
      text: result.text,
      finishReason: result.finishReason,
      usage: result.usage,
      stepCount: result.steps.length,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  }

  return result;
}
