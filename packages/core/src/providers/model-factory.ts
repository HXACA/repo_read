import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ResolvedConfig, RoleName, ProviderSdk } from "../types/config.js";
import { parseModelId } from "../types/config.js";
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
  const { provider: providerName, model: modelName } = parseModelId(route.primaryModel);

  // Find the provider config: explicit from model prefix, or resolved from route
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

  const npm = providerConfig?.npm ?? inferNpm(resolvedProviderName);
  return createModel(npm, resolvedProviderName, modelName, apiKey, providerConfig?.baseUrl);
}

/** Fallback: infer npm package from provider name for legacy configs without `npm`. */
function inferNpm(provider: string): ProviderSdk {
  if (provider === "anthropic") return "@ai-sdk/anthropic";
  if (provider === "openai") return "@ai-sdk/openai";
  return "@ai-sdk/openai-compatible";
}

function createModel(
  npm: ProviderSdk,
  providerName: string,
  modelId: string,
  apiKey: string,
  baseUrl?: string,
): LanguageModel {
  switch (npm) {
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
