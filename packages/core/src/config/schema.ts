import { z } from "zod/v4";

const RoleModelConfigSchema = z.object({
  model: z.string().min(1),
  fallback_models: z.array(z.string()),
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  reasoningSummary: z.enum(["auto", "concise", "detailed"]).optional(),
  serviceTier: z.enum(["fast", "flex"]).optional(),
});

const PresetSchema = z.enum(["quality", "balanced", "budget", "local-only"]);

const ProviderSdkSchema = z.enum([
  "@ai-sdk/anthropic",
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
]);

const ProviderModelConfigSchema = z.object({
  name: z.string().optional(),
  npm: ProviderSdkSchema.optional(),
  variant: z.enum(["responses", "chat"]).optional(),
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  reasoningSummary: z.enum(["auto", "concise", "detailed"]).optional(),
  serviceTier: z.enum(["fast", "flex"]).optional(),
});

const ProviderCredentialConfigSchema = z.object({
  provider: z.string().min(1),
  npm: ProviderSdkSchema.optional(),
  models: z.record(z.string(), ProviderModelConfigSchema).optional(),
  secretRef: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  enabled: z.boolean(),
});

const ProjectRoleConfigSchema = z.object({
  "catalog": RoleModelConfigSchema,
  "outline": RoleModelConfigSchema,
  "drafter": RoleModelConfigSchema,
  "worker": RoleModelConfigSchema,
  "reviewer": RoleModelConfigSchema,
});

const QualityOverridesSchema = z.object({
  forkWorkers: z.number().optional(),
  forkWorkerConcurrency: z.number().optional(),
  maxRevisionAttempts: z.number().optional(),
  catalogMaxSteps: z.number().optional(),
  drafterMaxSteps: z.number().optional(),
  workerMaxSteps: z.number().optional(),
  reviewerMaxSteps: z.number().optional(),
  reviewerVerifyMinCitations: z.number().optional(),
  reviewerStrictness: z.enum(["lenient", "normal", "strict"]).optional(),
  askMaxSteps: z.number().optional(),
  researchMaxSteps: z.number().optional(),
}).optional();

export const UserEditableConfigSchema = z.object({
  projectSlug: z.string().min(1),
  repoRoot: z.string().min(1),
  preset: PresetSchema,
  language: z.string().optional(),
  providers: z.array(ProviderCredentialConfigSchema).min(1),
  roles: ProjectRoleConfigSchema,
  qualityOverrides: QualityOverridesSchema,
});

export type UserEditableConfigInput = z.input<typeof UserEditableConfigSchema>;

export function parseUserEditableConfig(input: unknown) {
  return UserEditableConfigSchema.parse(input);
}
