import type { UserEditableConfig, ResolvedConfig, ResolvedRoleRoute, RoleName } from "../types/config.js";
import type { ModelCapability } from "../types/provider.js";

const PRESET_RETRIEVAL = {
  quality: { maxParallelReadsPerPage: 2, maxReadWindowLines: 300, allowControlledBash: true },
  balanced: { maxParallelReadsPerPage: 2, maxReadWindowLines: 300, allowControlledBash: true },
  budget: { maxParallelReadsPerPage: 2, maxReadWindowLines: 300, allowControlledBash: true },
  "local-only": { maxParallelReadsPerPage: 1, maxReadWindowLines: 300, allowControlledBash: false },
} as const;

export function detectModelFamily(model: string, provider: string): string {
  if (provider === "anthropic" || model.startsWith("claude")) return "anthropic-claude";
  if (provider === "openai" || model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3")) return "openai-gpt";
  if (provider === "google" || model.startsWith("gemini")) return "google-gemini";
  return "generic-openai-compatible";
}

function resolveRole(
  roleName: RoleName,
  config: UserEditableConfig,
  capabilities: ModelCapability[],
): ResolvedRoleRoute {
  const roleConfig = config.roles[roleName];
  const primaryModel = roleConfig.model;
  const cap = capabilities.find((c) => c.model === primaryModel && c.health !== "unavailable");
  const resolvedProvider = cap?.provider ?? config.providers[0].provider;
  const family = detectModelFamily(primaryModel, resolvedProvider);

  return {
    role: roleName,
    primaryModel,
    fallbackModels: roleConfig.fallback_models,
    resolvedProvider,
    systemPromptTuningId: family,
  };
}

export function resolveConfig(
  config: UserEditableConfig,
  capabilities: ModelCapability[],
): ResolvedConfig {
  const roles = {
    "main.author": resolveRole("main.author", config, capabilities),
    "fork.worker": resolveRole("fork.worker", config, capabilities),
    "fresh.reviewer": resolveRole("fresh.reviewer", config, capabilities),
  } as Record<RoleName, ResolvedRoleRoute>;

  return {
    projectSlug: config.projectSlug,
    repoRoot: config.repoRoot,
    preset: config.preset,
    roles,
    providers: config.providers.map((p) => ({
      ...p,
      capabilities: capabilities.filter((c) => c.provider === p.provider),
    })),
    retrieval: { ...PRESET_RETRIEVAL[config.preset] },
  };
}
