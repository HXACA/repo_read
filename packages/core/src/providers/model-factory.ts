import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ResolvedConfig, RoleName, ProviderSdk } from "../types/config.js";
import { parseModelId } from "../types/config.js";
import { AppError } from "../errors.js";
import { getDebugDir, createDebugFetch } from "../utils/debug-fetch.js";

export type ModelFactoryOptions = {
  apiKeys: Record<string, string>;
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
  // Inject debug fetch when debug mode is active
  const fetchFn = getDebugDir() ? createDebugFetch() : undefined;
  return createModel(npm, resolvedProviderName, modelName, apiKey, providerConfig?.baseUrl, fetchFn, modelConfig?.variant);
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
        : openai(modelId);
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
