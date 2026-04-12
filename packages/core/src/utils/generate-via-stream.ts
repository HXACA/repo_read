/**
 * Streaming-compatible wrapper around AI SDK's text generation.
 *
 * Uses `streamText` internally to support API endpoints that require
 * `stream: true` (e.g. OpenAI Responses API proxies). Returns the same
 * shape as `generateText` for drop-in compatibility.
 *
 * Debug logging is handled at the HTTP fetch layer (see debug-fetch.ts),
 * not here.
 */

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

export async function generateViaStream(
  params: StreamTextParams,
): Promise<GenerateViaStreamResult> {
  const stream = streamText(params);

  const text = await stream.text;
  const finishReason = (await stream.finishReason) ?? "stop";
  const usage = (await stream.usage) ?? {};
  const toolCalls = (await stream.toolCalls) ?? [];
  const toolResults = (await stream.toolResults) ?? [];
  const steps = (await stream.steps) ?? [];

  return { text, finishReason, usage, toolCalls, toolResults, steps };
}
