/**
 * Streaming-compatible wrapper around AI SDK's text generation.
 *
 * Some API endpoints (e.g. OpenAI Responses API proxies) require `stream: true`
 * and reject non-streaming requests. This wrapper always uses `streamText` and
 * collects the full result, providing the same interface as `generateText`.
 *
 * Tests that mock `ai`'s `streamText` will work transparently.
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
  const result = streamText(params);

  const text = await result.text;
  const finishReason = (await result.finishReason) ?? "stop";
  const usage = (await result.usage) ?? {};
  const toolCalls = (await result.toolCalls) ?? [];
  const toolResults = (await result.toolResults) ?? [];
  const steps = (await result.steps) ?? [];

  return { text, finishReason, usage, toolCalls, toolResults, steps };
}
