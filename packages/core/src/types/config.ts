export type Preset = "quality" | "balanced" | "budget" | "local-only";
export type RoleName = "catalog" | "outline" | "drafter" | "worker" | "reviewer";

export type RoleModelConfig = {
  /** Model identifier in `provider/model` format, e.g. `"openrouter/qwen/qwen3.6-plus"` or `"glm/glm-5.1"`.
   *  The part before the first `/` must match a `provider` name in `providers[]`.
   *  SDK protocol comes from the provider's `npm` field — roles don't configure it. */
  model: string;
  fallback_models: string[];
};

export type ProjectRoleConfig = Record<RoleName, RoleModelConfig>;

/**
 * Which AI SDK npm package to use for this provider.
 * - `"@ai-sdk/anthropic"` — Anthropic native
 * - `"@ai-sdk/openai"` — OpenAI Responses API (standard for OpenAI)
 * - `"@ai-sdk/openai-compatible"` — OpenAI Chat Completions compatible (default)
 */
export type ProviderSdk =
  | "@ai-sdk/anthropic"
  | "@ai-sdk/openai"
  | "@ai-sdk/openai-compatible";

export type ProviderCredentialConfig = {
  provider: string;
  /** AI SDK npm package. Defaults to `"@ai-sdk/openai-compatible"`. */
  npm?: ProviderSdk;
  secretRef: string;
  apiKey?: string;
  baseUrl?: string;
  enabled: boolean;
};

export type UserEditableConfig = {
  projectSlug: string;
  repoRoot: string;
  preset: Preset;
  language?: string;
  providers: ProviderCredentialConfig[];
  roles: ProjectRoleConfig;
  /** Override individual QualityProfile fields from the preset defaults. */
  qualityOverrides?: Partial<import("../config/quality-profile.js").QualityProfile>;
};

export type ResolvedRoleRoute = {
  role: RoleName;
  primaryModel: string;
  fallbackModels: string[];
  resolvedProvider: string;
  systemPromptTuningId: string;
};

export type ResolvedConfig = {
  projectSlug: string;
  repoRoot: string;
  preset: Preset;
  roles: Record<RoleName, ResolvedRoleRoute>;
  language: string;
  providers: Array<{
    provider: string;
    npm?: ProviderSdk;
    secretRef: string;
    apiKey?: string;
    baseUrl?: string;
    enabled: boolean;
    capabilities: import("./provider.js").ModelCapability[];
  }>;
  retrieval: {
    maxParallelReadsPerPage: number;
    maxReadWindowLines: number;
    allowControlledBash: boolean;
  };
  qualityProfile: import("../config/quality-profile.js").QualityProfile;
};

/**
 * Parse `"provider/model"` format. First `/` splits provider from model.
 * e.g. `"openrouter/qwen/qwen3.6-plus"` → `{ provider: "openrouter", model: "qwen/qwen3.6-plus" }`
 *      `"glm/glm-5.1"` → `{ provider: "glm", model: "glm-5.1" }`
 *      `"claude-sonnet-4-6"` → `{ provider: undefined, model: "claude-sonnet-4-6" }` (legacy)
 */
export function parseModelId(modelId: string): { provider: string | undefined; model: string } {
  const idx = modelId.indexOf("/");
  if (idx === -1) return { provider: undefined, model: modelId };
  return { provider: modelId.slice(0, idx), model: modelId.slice(idx + 1) };
}
