export type Preset = "quality" | "balanced" | "budget" | "local-only";
export type RoleName = "main.author" | "fork.worker" | "fresh.reviewer";

export type RoleModelConfig = {
  model: string;
  fallback_models: string[];
  /** Explicitly bind this role to a provider declared in `providers[]`. When
   *  omitted, the system infers the provider from the model name. */
  provider?: string;
};

export type ProjectRoleConfig = Record<RoleName, RoleModelConfig>;

/**
 * Which AI SDK adapter to use for this provider.
 * Maps directly to npm packages:
 * - `"@ai-sdk/anthropic"` — Anthropic native
 * - `"@ai-sdk/openai"` — OpenAI Chat Completions
 * - `"@ai-sdk/openai:responses"` — OpenAI Responses API
 * - `"@ai-sdk/openai-compatible"` — Any OpenAI-compatible endpoint (default)
 */
export type ProviderSdk =
  | "@ai-sdk/anthropic"
  | "@ai-sdk/openai"
  | "@ai-sdk/openai:responses"
  | "@ai-sdk/openai-compatible";

export type ProviderCredentialConfig = {
  provider: string;
  /** Which AI SDK adapter to use. Defaults to `"@ai-sdk/openai-compatible"`. */
  sdk?: ProviderSdk;
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
    sdk?: ProviderSdk;
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
