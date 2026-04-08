import { z } from "zod/v4";

const RoleModelConfigSchema = z.strictObject({
  model: z.string().min(1),
  fallback_models: z.array(z.string()),
});

const PresetSchema = z.enum(["quality", "balanced", "budget", "local-only"]);

const ProviderCredentialConfigSchema = z.object({
  provider: z.string().min(1),
  secretRef: z.string(),
  baseUrl: z.string().optional(),
  enabled: z.boolean(),
});

const ProjectRoleConfigSchema = z.strictObject({
  "main.author": RoleModelConfigSchema,
  "fork.worker": RoleModelConfigSchema,
  "fresh.reviewer": RoleModelConfigSchema,
});

export const UserEditableConfigSchema = z.object({
  projectSlug: z.string().min(1),
  repoRoot: z.string().min(1),
  preset: PresetSchema,
  providers: z.array(ProviderCredentialConfigSchema).min(1),
  roles: ProjectRoleConfigSchema,
});

export type UserEditableConfigInput = z.input<typeof UserEditableConfigSchema>;

export function parseUserEditableConfig(input: unknown) {
  return UserEditableConfigSchema.parse(input);
}
