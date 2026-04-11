/**
 * Streaming-compatible wrapper around AI SDK's text generation.
 *
 * Debug mode (REPOREAD_DEBUG=1): logs the FULL request and response for
 * every LLM call — one file per call with complete system/prompt/tools/steps.
 *
 * Debug logs go to the job's debug directory:
 *   .reporead/projects/<slug>/jobs/<jobId>/debug/<seq>-<ts>.json
 * Call `setDebugDir(path)` before running the pipeline to configure this.
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

let debugSeq = 0;
let debugDir: string | null = null;

/** Set the directory where debug logs will be written. Call once per job. */
export function setDebugDir(dir: string | null): void {
  debugDir = dir;
  debugSeq = 0;
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
  const debug = isDebug();
  const start = debug ? Date.now() : 0;
  const seq = debug ? String(++debugSeq).padStart(4, "0") : "";
  const ts = debug ? new Date().toISOString().replace(/[:.]/g, "-") : "";

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
      await writeDebug(`${seq}-${ts}-ERROR.json`, {
        request: {
          modelId: getModelId(params),
          system: params.system,
          prompt: params.prompt,
          messages: params.messages,
          tools: serializeTools(params.tools),
        },
        error: {
          message: err.message,
          name: err.name,
          statusCode: (err as any).statusCode,
          responseBody: (err as any).responseBody,
        },
        durationMs: Date.now() - start,
      });
    }
    throw error;
  }

  if (debug) {
    await writeDebug(`${seq}-${ts}.json`, {
      request: {
        modelId: getModelId(params),
        system: params.system,
        prompt: params.prompt,
        messages: params.messages,
        tools: serializeTools(params.tools),
      },
      response: {
        text: result.text,
        finishReason: result.finishReason,
        usage: result.usage,
        toolCalls: result.toolCalls,
        toolResults: result.toolResults,
        steps: result.steps,
      },
      durationMs: Date.now() - start,
    });
  }

  return result;
}
