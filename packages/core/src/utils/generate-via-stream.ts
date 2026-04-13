/**
 * Provider options management for OpenAI Responses API models.
 *
 * `buildResponsesProviderOptions` is a **pure function** — it reads from
 * explicit parameters, not from module-level globals. Callers pass
 * `ProviderCallOptions` (cacheKey, reasoning, serviceTier) through the
 * request-scoped `providerCallOptions` field on `AgentLoopOptions`.
 *
 * The only remaining module-level state is `sessionId`, used exclusively
 * by model-factory to inject the `session_id` HTTP header. It will be
 * removed in Phase 3.
 */

import type { LanguageModel } from "ai";
import type { ProviderCallOptions } from "../runtime/turn-types.js";

// ── Session-id header state (Phase 3 will remove) ──────────────────────────

let sessionId: string | null = null;

/** Set the session ID injected into OpenAI fetch headers. Call once per job. */
export function setSessionId(id: string | null): void {
  sessionId = id;
}

/** Get the current session ID (used by model-factory for session_id header). */
export function getSessionId(): string | null {
  return sessionId;
}

// ── Provider call options (pure) ────────────────────────────────────────────
// ProviderCallOptions is now canonically defined in runtime/turn-types.ts

/**
 * Build Responses API provider options for a given model.
 * Pure function — reads from explicit `options`, not from globals.
 * Returns null if the model is not an OpenAI Responses model.
 */
export function buildResponsesProviderOptions(
  model: LanguageModel,
  options?: ProviderCallOptions,
): {
  providerOptions: Record<string, unknown>;
  stripSystem: boolean;
  stripMaxOutputTokens: boolean;
} | null {
  const isOpenAIResponses = (model as unknown as { provider?: string })?.provider === "openai.responses";
  if (!isOpenAIResponses) return null;

  const openaiOptions: Record<string, unknown> = {};
  // store=false: send full history, no item_reference (proxy-compatible)
  openaiOptions.store = false;
  // promptCacheKey: improves routing stickiness so requests hit the same
  // engine and reuse cached KV state (same pattern as Codex's conversation_id)
  if (options?.cacheKey) openaiOptions.promptCacheKey = options.cacheKey;
  // Enable reasoning (thinking) when configured for the model
  if (options?.reasoning) {
    openaiOptions.reasoningEffort = options.reasoning.effort;
    openaiOptions.reasoningSummary = options.reasoning.summary;
  }
  // Service tier: "fast" → "priority" (like Codex), "flex" → "flex"
  if (options?.serviceTier) {
    openaiOptions.serviceTier =
      options.serviceTier === "fast" ? "priority" : options.serviceTier;
  }

  return {
    providerOptions: { openai: openaiOptions },
    stripSystem: true, // caller should move system to instructions
    stripMaxOutputTokens: false, // let maxOutputTokens through — proxies with pass_through support it
  };
}
