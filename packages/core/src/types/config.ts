export type Preset = "quality" | "balanced" | "budget" | "local-only";
export type RoleName = "catalog" | "outline" | "drafter" | "worker" | "reviewer";

export type RoleModelConfig = {
  /** Model identifier in `provider/model` format, e.g. `"openrouter/qwen/qwen3.6-plus"` or `"glm/glm-5.1"`.
   *  The part before the first `/` must match a `provider` name in `providers[]`.
   *  SDK protocol comes from the provider's `npm` field — roles don't configure it. */
  model: string;
  fallback_models: string[];
  /** Override reasoning effort for this role (takes precedence over model-level config). */
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Override reasoning summary for this role. */
  reasoningSummary?: "auto" | "concise" | "detailed";
  /** Override service tier for this role. */
  serviceTier?: "fast" | "flex";
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

export type ProviderRateLimitConfig = {
  /** Max in-flight requests sharing this bucket. Defaults to 6. */
  maxConcurrent?: number;
  /** Minimum milliseconds between request launches (1000/QPS). Defaults to 0. */
  minIntervalMs?: number;
};

/** Per-model config declared within a provider. */
export type ProviderModelConfig = {
  name?: string;
  /** Override the provider's default npm for this specific model. */
  npm?: ProviderSdk;
  /** Protocol variant for @ai-sdk/openai: "responses" or "chat".
   *  When omitted, auto-detected from model name (gpt-5+ → responses, else chat). */
  variant?: "responses" | "chat";
  /** Reasoning effort for thinking-capable models.
   *  When omitted, reasoning is not enabled. */
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Reasoning summary mode. Defaults to "auto" when reasoningEffort is set. */
  reasoningSummary?: "auto" | "concise" | "detailed";
  /** OpenAI service tier. "fast" maps to "priority" (faster, costlier), "flex" may queue (cheaper). */
  serviceTier?: "fast" | "flex";
  /**
   * Per-model rate limit. Gives each model its own token bucket (keyed by
   * `provider:model`), so different models under the same provider can have
   * independent concurrency/QPS ceilings. Takes precedence over the
   * provider-level `rateLimit` when both are declared.
   */
  rateLimit?: ProviderRateLimitConfig;
};

export type ProviderCredentialConfig = {
  provider: string;
  /** Default AI SDK npm package for all models. Defaults to `"@ai-sdk/openai-compatible"`. */
  npm?: ProviderSdk;
  secretRef: string;
  apiKey?: string;
  baseUrl?: string;
  enabled: boolean;
  /** Declared models. Roles can only reference models listed here (when present).
   *  Key = model ID (e.g. `"glm-5.1"` or `"qwen/qwen3.6-plus"`). */
  models?: Record<string, ProviderModelConfig>;
  /**
   * Provider-level fallback rate limit. Applies to every model under this
   * provider that does NOT declare its own `models[id].rateLimit`. Useful
   * for account-wide plans (e.g., kingxliu's "Token Plan") where the limit
   * is shared across all models.
   */
  rateLimit?: ProviderRateLimitConfig;
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
  /** Role-level overrides (take precedence over model-level config). */
  reasoningEffort?: string;
  reasoningSummary?: string;
  serviceTier?: string;
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
    models?: Record<string, ProviderModelConfig>;
    secretRef: string;
    apiKey?: string;
    baseUrl?: string;
    enabled: boolean;
    capabilities: import("./provider.js").ModelCapability[];
    rateLimit?: ProviderRateLimitConfig;
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
