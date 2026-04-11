import { z } from "zod/v4";

const RoleModelConfigSchema = z.object({
  model: z.string().min(1),
  fallback_models: z.array(z.string()),
  provider: z.string().optional(),
});

const PresetSchema = z.enum(["quality", "balanced", "budget", "local-only"]);

const ProviderSdkSchema = z.enum([
  "@ai-sdk/anthropic",
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
]);

const ProviderCredentialConfigSchema = z.object({
  provider: z.string().min(1),
  npm: ProviderSdkSchema.optional(),
  secretRef: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  enabled: z.boolean(),
});

const ProjectRoleConfigSchema = z.object({
  "main.author": RoleModelConfigSchema,
  "fork.worker": RoleModelConfigSchema,
  "fresh.reviewer": RoleModelConfigSchema,
});

const QualityOverridesSchema = z.object({
  forkWorkers: z.number().optional(),
  forkWorkerConcurrency: z.number().optional(),
  maxRevisionAttempts: z.number().optional(),
  catalogMaxSteps: z.number().optional(),
  drafterMaxSteps: z.number().optional(),
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
