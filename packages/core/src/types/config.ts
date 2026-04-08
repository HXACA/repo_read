export type Preset = "quality" | "balanced" | "budget" | "local-only";
export type RoleName = "main.author" | "fork.worker" | "fresh.reviewer";

export type RoleModelConfig = {
  model: string;
  fallback_models: string[];
};

export type ProjectRoleConfig = Record<RoleName, RoleModelConfig>;

export type ProviderCredentialConfig = {
  provider: string;
  secretRef: string;
  baseUrl?: string;
  enabled: boolean;
};

export type UserEditableConfig = {
  projectSlug: string;
  repoRoot: string;
  preset: Preset;
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
  providers: Array<{
    provider: string;
    secretRef: string;
    baseUrl?: string;
    enabled: boolean;
    capabilities: import("./provider.js").ModelCapability[];
  }>;
  retrieval: {
    maxParallelReadsPerPage: number;
    maxReadWindowLines: number;
    allowControlledBash: boolean;
  };
};
