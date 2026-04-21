import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ResolvedConfig, RoleName, ProviderSdk } from "../types/config.js";
import { parseModelId } from "../types/config.js";
import { AppError } from "../errors.js";
import { getDebugDir, createDebugFetch } from "../utils/debug-fetch.js";
import { createResilientFetch, createWallClockFetch } from "../utils/resilient-fetch.js";
import { createRateLimitedFetch, getProviderBucket } from "../utils/rate-limiter.js";
import type { WakeSource } from "../utils/diagnostics.js";

export type ModelFactoryOptions = {
  apiKeys: Record<string, string>;
  /**
   * Optional wake-from-sleep signal source. When provided, every fetch
   * this model issues subscribes to the live signal so a laptop-sleep
   * wake aborts in-flight requests. See `createWakeSource` in
   * `utils/diagnostics.ts` for the lifecycle.
   */
  wakeSource?: WakeSource;
};

export function createModelForRole(
  config: ResolvedConfig,
  role: RoleName,
  options: ModelFactoryOptions,
): LanguageModel {
  const route = config.roles[role];
  const { provider: providerName, model: modelName } = parseModelId(route.primaryModel);

  const resolvedProviderName = providerName ?? route.resolvedProvider;
  const providerConfig = config.providers.find(
    (p) => p.provider === resolvedProviderName && p.enabled,
  );

  const apiKey = options.apiKeys[resolvedProviderName];
  if (!apiKey) {
    throw new AppError(
      "PROVIDER_AUTH_FAILED",
      `No API key found for provider "${resolvedProviderName}" (role: ${role})`,
    );
  }

  // Look up model-specific config from provider's declared models
  const modelConfig = providerConfig?.models?.[modelName];

  // npm priority: model-level > provider-level > inferred from provider name
  const npm = modelConfig?.npm ?? providerConfig?.npm ?? inferNpm(resolvedProviderName);
  // Fetch wrapping order (innermost → outermost):
  //   globalThis.fetch
  //     → debugFetch (when REPOREAD_DEBUG=1) records request/response pairs
  //     → resilientFetch adds SSE-aware inter-chunk timeout
  //     → rateLimitedFetch(provider bucket) — account-wide cap (if configured)
  //     → rateLimitedFetch(model bucket)    — per-model cap (if configured)
  //     → wallClockFetch — OUTERMOST hard ceiling on total request duration
  //
  // The wall-clock wrapper sits outside the rate limiters so its AbortSignal
  // propagates down through bucket.acquire(): if a permit leaks or an
  // upstream stream never resolves, the timer unsticks every await in the
  // chain after `wallClockTimeoutMs` (default 10 minutes).
  //
  // Rate limiting still sits outside resilient-fetch so buckets also gate
  // retries and debug-mode replays. Both rate-limit levels stack — a request
  // must acquire BOTH its per-model budget AND any account-wide budget.
  const debugFetchFn = getDebugDir() ? createDebugFetch() : undefined;
  const resilientFetchFn = createResilientFetch(debugFetchFn ?? globalThis.fetch);
  let fetchFn: typeof globalThis.fetch = resilientFetchFn;
  if (providerConfig?.rateLimit) {
    fetchFn = createRateLimitedFetch(
      fetchFn,
      getProviderBucket(resolvedProviderName, providerConfig.rateLimit),
    );
  }
  if (modelConfig?.rateLimit) {
    fetchFn = createRateLimitedFetch(
      fetchFn,
      getProviderBucket(`${resolvedProviderName}:${modelName}`, modelConfig.rateLimit),
    );
  }
  fetchFn = createWallClockFetch(fetchFn, {
    ...(options.wakeSource ? { wakeSignal: options.wakeSource.getSignal } : {}),
  });
  return createModel(npm, resolvedProviderName, modelName, apiKey, providerConfig?.baseUrl, fetchFn, modelConfig?.variant);
}

export type ModelOptions = {
  reasoning: { effort: string; summary: string } | null;
  serviceTier: string | null;
};

/** Look up model options (reasoning, serviceTier) for a role.
 *  Priority: role-level override > model-level config. */
export function getModelOptionsForRole(
  config: ResolvedConfig,
  role: RoleName,
): ModelOptions {
  const route = config.roles[role];
  const { provider: providerName, model: modelName } = parseModelId(route.primaryModel);
  const resolvedProviderName = providerName ?? route.resolvedProvider;
  const providerConfig = config.providers.find(
    (p) => p.provider === resolvedProviderName && p.enabled,
  );
  const modelConfig = providerConfig?.models?.[modelName];

  // Role-level overrides take precedence over model-level config
  const effort = route.reasoningEffort ?? modelConfig?.reasoningEffort;
  const summary = route.reasoningSummary ?? modelConfig?.reasoningSummary;
  const tier = route.serviceTier ?? modelConfig?.serviceTier;

  return {
    reasoning: effort ? { effort, summary: summary ?? "auto" } : null,
    serviceTier: tier ?? null,
  };
}

function inferNpm(provider: string): ProviderSdk {
  if (provider === "anthropic") return "@ai-sdk/anthropic";
  if (provider === "openai") return "@ai-sdk/openai";
  return "@ai-sdk/openai-compatible";
}

/**
 * Auto-detect OpenAI protocol variant from model name.
 * gpt-5+ (except gpt-5-mini) → responses, everything else → chat.
 */
function detectOpenAIVariant(modelId: string): "responses" | "chat" {
  const match = /^gpt-(\d+)/.exec(modelId);
  if (!match) return "chat";
  const major = Number(match[1]);
  if (major >= 5 && !modelId.startsWith("gpt-5-mini")) return "responses";
  return "chat";
}

function createModel(
  npm: ProviderSdk,
  providerName: string,
  modelId: string,
  apiKey: string,
  baseUrl?: string,
  fetchFn?: typeof globalThis.fetch,
  variant?: "responses" | "chat",
): LanguageModel {
  switch (npm) {
    case "@ai-sdk/anthropic": {
      const authOpts = baseUrl
        ? { authToken: apiKey, baseURL: baseUrl }
        : { apiKey };
      const anthropic = createAnthropic({ ...authOpts, ...(fetchFn ? { fetch: fetchFn } : {}) });
      return anthropic(modelId);
    }
    case "@ai-sdk/openai": {
      const openai = createOpenAI({
        apiKey,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
        ...(fetchFn ? { fetch: fetchFn } : {}),
      });
      const resolved = variant ?? detectOpenAIVariant(modelId);
      return resolved === "responses"
        ? openai.responses(modelId)
        : openai.chat(modelId);
    }
    case "@ai-sdk/openai-compatible":
    default: {
      const compatible = createOpenAICompatible({
        name: providerName,
        apiKey,
        baseURL: baseUrl ?? `https://api.${providerName}.com/v1`,
        ...(fetchFn ? { fetch: fetchFn } : {}),
      });
      return compatible(modelId);
    }
  }
}
