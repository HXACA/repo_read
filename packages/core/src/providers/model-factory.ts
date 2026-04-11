import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ResolvedConfig, RoleName } from "../types/config.js";
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

  return createModel(route.resolvedProvider, route.primaryModel, apiKey, providerConfig?.baseUrl);
}

function createModel(
  provider: string,
  modelId: string,
  apiKey: string,
  baseUrl?: string,
): LanguageModel {
  switch (provider) {
    case "anthropic": {
      // If custom baseUrl, use authToken (Bearer) instead of x-api-key
      const authOpts = baseUrl
        ? { authToken: apiKey, baseURL: baseUrl }
        : { apiKey };
      const anthropic = createAnthropic(authOpts);
      return anthropic(modelId);
    }
    case "openai": {
      const openai = createOpenAI({
        apiKey,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
      });
      return openai.responses(modelId);
    }
    default: {
      const compatible = createOpenAICompatible({
        name: provider,
        apiKey,
        baseURL: baseUrl ?? `https://api.${provider}.com/v1`,
      });
      return compatible(modelId);
    }
  }
}
