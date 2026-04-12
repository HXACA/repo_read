/**
 * Streaming-compatible wrapper around AI SDK's text generation.
 *
 * Uses `streamText` internally to support API endpoints that require
 * `stream: true` (e.g. OpenAI Responses API proxies). Returns the same
 * shape as `generateText` for drop-in compatibility.
 *
 * For OpenAI Responses API models:
 * - Sets `store: false` to send full history (no item_reference)
 * - Sets `promptCacheKey` for server-side prompt prefix caching
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

let cacheKey: string | null = null;

/** Set a cache key for prompt caching. Call once per job with jobId or jobId-pageSlug. */
export function setCacheKey(key: string | null): void {
  cacheKey = key;
}

export async function generateViaStream(
  params: StreamTextParams,
): Promise<GenerateViaStreamResult> {
  const isOpenAIResponses = (params.model as any)?.provider === "openai.responses";

  const openaiOptions: Record<string, unknown> = {};
  if (isOpenAIResponses) {
    // store=false: send full history, no item_reference (proxy-compatible)
    openaiOptions.store = false;
    // promptCacheKey: server caches the instructions prefix across multi-step requests
    if (cacheKey) openaiOptions.promptCacheKey = cacheKey;
    // Move system prompt to instructions field — Responses API caches instructions
    // content server-side (tied to promptCacheKey). Without this, system prompt goes
    // into the input array as a developer message and isn't cached.
    const system = (params as any).system;
    if (typeof system === "string" && system) {
      openaiOptions.instructions = system;
    }
  }

  const needsProviderOptions = isOpenAIResponses;
  const stream = streamText(needsProviderOptions ? {
    ...params,
    providerOptions: {
      ...((params as any).providerOptions ?? {}),
      openai: {
        ...((params as any).providerOptions?.openai ?? {}),
        ...openaiOptions,
      },
    },
  } : params);

  const text = await stream.text;
  const finishReason = (await stream.finishReason) ?? "stop";
  const usage = (await stream.usage) ?? {};
  const toolCalls = (await stream.toolCalls) ?? [];
  const toolResults = (await stream.toolResults) ?? [];
  const steps = (await stream.steps) ?? [];

  return { text, finishReason, usage, toolCalls, toolResults, steps };
}
