/**
 * Streaming-compatible wrapper around AI SDK's text generation.
 *
 * Some API endpoints (e.g. OpenAI Responses API proxies) require `stream: true`
 * and reject non-streaming requests. This wrapper always uses `streamText` and
 * collects the full result, providing the same interface as `generateText`.
 *
 * Debug mode: set REPOREAD_DEBUG=1 to log full request/response pairs to
 * .reporead/debug/<timestamp>-<seq>.json for troubleshooting model behavior.
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

function isDebug(): boolean {
  return process.env.REPOREAD_DEBUG === "1" || process.env.REPOREAD_DEBUG === "true";
}

async function writeDebugLog(params: StreamTextParams, result: GenerateViaStreamResult, durationMs: number): Promise<void> {
  try {
    const debugDir = path.join(process.cwd(), ".reporead", "debug");
    await fs.mkdir(debugDir, { recursive: true });

    const seq = String(++debugSeq).padStart(4, "0");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(debugDir, `${ts}-${seq}.json`);

    // Extract serializable request data
    const request: Record<string, unknown> = {};
    if (params.system) request.system = params.system;
    if (params.prompt) request.prompt = params.prompt;
    if (params.messages) request.messages = params.messages;
    if (params.tools) request.toolNames = Object.keys(params.tools);
    if ((params as Record<string, unknown>).maxSteps) request.maxSteps = (params as Record<string, unknown>).maxSteps;
    // Model info — try to get model ID
    if (params.model) {
      const m = params.model as Record<string, unknown>;
      request.modelId = m.modelId ?? m.id ?? String(params.model);
    }

    const response: Record<string, unknown> = {
      text: result.text,
      finishReason: result.finishReason,
      usage: result.usage,
      textLength: result.text.length,
      toolCallCount: result.toolCalls.length,
      stepCount: result.steps.length,
    };

    const log = { request, response, durationMs };
    await fs.writeFile(filePath, JSON.stringify(log, null, 2), "utf-8");
  } catch {
    // Debug logging should never break the pipeline
  }
}

async function writeDebugError(params: StreamTextParams, error: unknown, durationMs: number): Promise<void> {
  try {
    const debugDir = path.join(process.cwd(), ".reporead", "debug");
    await fs.mkdir(debugDir, { recursive: true });

    const seq = String(++debugSeq).padStart(4, "0");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(debugDir, `${ts}-${seq}-ERROR.json`);

    const request: Record<string, unknown> = {};
    if (params.system) request.system = params.system;
    if (params.prompt) request.prompt = params.prompt;
    if (params.messages) request.messages = params.messages;
    if (params.tools) request.toolNames = Object.keys(params.tools);
    if (params.model) {
      const m = params.model as Record<string, unknown>;
      request.modelId = m.modelId ?? m.id ?? String(params.model);
    }

    const err = error instanceof Error
      ? { message: error.message, name: error.name, ...(error as any).statusCode ? { statusCode: (error as any).statusCode } : {}, ...(error as any).responseBody ? { responseBody: (error as any).responseBody } : {} }
      : { message: String(error) };

    const log = { request, error: err, durationMs };
    await fs.writeFile(filePath, JSON.stringify(log, null, 2), "utf-8");
  } catch {
    // Debug logging should never break the pipeline
  }
}

export async function generateViaStream(
  params: StreamTextParams,
): Promise<GenerateViaStreamResult> {
  const debug = isDebug();
  const start = debug ? Date.now() : 0;

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
    if (debug) await writeDebugError(params, error, Date.now() - start);
    throw error;
  }

  if (debug) await writeDebugLog(params, result, Date.now() - start);
  return result;
}
