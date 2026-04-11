import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ResolvedConfig, RoleName, ProviderSdk } from "../types/config.js";
import { AppError } from "../errors.js";

export type ModelFactoryOptions = {
  apiKeys: Record<string, string>;
};

export function createModelForRole(
  config: ResolvedConfig,
  role: RoleName,
  options: ModelFactoryOptions,
): LanguageModel {
  const route = config.roles[role];
  const providerConfig = config.providers.find(
    (p) => p.provider === route.resolvedProvider && p.enabled,
  );

  const apiKey = options.apiKeys[route.resolvedProvider];
  if (!apiKey) {
    throw new AppError(
      "PROVIDER_AUTH_FAILED",
      `No API key found for provider "${route.resolvedProvider}" (role: ${role})`,
    );
  }

  const sdk = providerConfig?.sdk ?? inferSdk(route.resolvedProvider);
  return createModel(sdk, route.resolvedProvider, route.primaryModel, apiKey, providerConfig?.baseUrl);
}

/** Fallback: infer SDK from provider name for configs that omit `sdk`. */
function inferSdk(provider: string): ProviderSdk {
  if (provider === "anthropic") return "@ai-sdk/anthropic";
  if (provider === "openai") return "@ai-sdk/openai:responses";
  return "@ai-sdk/openai-compatible";
}

function createModel(
  sdk: ProviderSdk,
  providerName: string,
  modelId: string,
  apiKey: string,
  baseUrl?: string,
): LanguageModel {
  switch (sdk) {
    case "@ai-sdk/anthropic": {
      const authOpts = baseUrl
        ? { authToken: apiKey, baseURL: baseUrl }
        : { apiKey };
      const anthropic = createAnthropic(authOpts);
      return anthropic(modelId);
    }
    case "@ai-sdk/openai": {
      const openai = createOpenAI({
        apiKey,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
      });
      return openai(modelId);
    }
    case "@ai-sdk/openai:responses": {
      const openai = createOpenAI({
        apiKey,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
      });
      return openai.responses(modelId);
    }
    case "@ai-sdk/openai-compatible":
    default: {
      const compatible = createOpenAICompatible({
        name: providerName,
        apiKey,
        baseURL: baseUrl ?? `https://api.${providerName}.com/v1`,
      });
      return compatible(modelId);
    }
  }
}
