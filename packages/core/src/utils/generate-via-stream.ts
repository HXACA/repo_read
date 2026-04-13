/**
 * Provider options management for OpenAI Responses API models.
 *
 * Holds global job-scoped state (cache key, model options) and exposes
 * helpers consumed by the generation pipeline and agent loop:
 *
 * - `setCacheKey` / `getCacheKey` — prompt-cache routing key, set once per job
 * - `setModelOptions` — reasoning effort + service tier for subsequent calls
 * - `buildResponsesProviderOptions` — constructs the `providerOptions` block
 *   for models whose provider is `openai.responses`
 */

import type { LanguageModel } from "ai";

let cacheKey: string | null = null;
let currentModelOptions: {
  reasoning: { effort: string; summary: string } | null;
  serviceTier: string | null;
} = { reasoning: null, serviceTier: null };

/** Set a cache key for prompt caching. Call once per job with jobId. */
export function setCacheKey(key: string | null): void {
  cacheKey = key;
}

/** Get the current cache key (used by model-factory for session_id header). */
export function getCacheKey(): string | null {
  return cacheKey;
}

/** Set model options (reasoning, serviceTier) for subsequent calls. */
export function setModelOptions(options: {
  reasoning: { effort: string; summary: string } | null;
  serviceTier: string | null;
}): void {
  currentModelOptions = options;
}

/**
 * Build Responses API provider options for a given model.
 * Reusable by the agent loop and any direct streamText calls.
 * Returns null if the model is not an OpenAI Responses model.
 */
export function buildResponsesProviderOptions(model: LanguageModel): {
  providerOptions: Record<string, unknown>;
  stripSystem: boolean;
  stripMaxOutputTokens: boolean;
} | null {
  const isOpenAIResponses = (model as any)?.provider === "openai.responses";
  if (!isOpenAIResponses) return null;

  const openaiOptions: Record<string, unknown> = {};
  // store=false: send full history, no item_reference (proxy-compatible)
  openaiOptions.store = false;
  // promptCacheKey: improves routing stickiness so requests hit the same
  // engine and reuse cached KV state (same pattern as Codex's conversation_id)
  if (cacheKey) openaiOptions.promptCacheKey = cacheKey;
  // Enable reasoning (thinking) when configured for the model
  if (currentModelOptions.reasoning) {
    openaiOptions.reasoningEffort = currentModelOptions.reasoning.effort;
    openaiOptions.reasoningSummary = currentModelOptions.reasoning.summary;
  }
  // Service tier: "fast" → "priority" (like Codex), "flex" → "flex"
  if (currentModelOptions.serviceTier) {
    openaiOptions.serviceTier =
      currentModelOptions.serviceTier === "fast" ? "priority" : currentModelOptions.serviceTier;
  }

  return {
    providerOptions: { openai: openaiOptions },
    stripSystem: true, // caller should move system to instructions
    stripMaxOutputTokens: false, // let maxOutputTokens through — proxies with pass_through support it
  };
}
