import type { UserEditableConfig, ResolvedConfig, RoleName } from "../types/config.js";
import type { ModelCapability } from "../types/provider.js";
import { getStaticCapabilities } from "./capability.js";
import { resolveConfig } from "../config/resolver.js";

export class ProviderCenter {
  private capabilityCache: Map<string, ModelCapability> = new Map();

  resolve(config: UserEditableConfig): ResolvedConfig {
    const capabilities = this.gatherCapabilities(config);
    return resolveConfig(config, capabilities);
  }

  summarize(config: UserEditableConfig): string {
    const resolved = this.resolve(config);
    const lines: string[] = ["=== Role Routing Summary ===", ""];

    for (const roleName of ["main.author", "fork.worker", "fresh.reviewer"] as RoleName[]) {
      const route = resolved.roles[roleName];
      lines.push(`${roleName}:`);
      lines.push(`  Primary: ${route.primaryModel} (${route.resolvedProvider})`);
      lines.push(`  Family:  ${route.systemPromptTuningId}`);
      if (route.fallbackModels.length > 0) {
        lines.push(`  Fallback: ${route.fallbackModels.join(", ")}`);
      }
      lines.push("");
    }

    lines.push(`Preset: ${resolved.preset}`);
    lines.push(`Retrieval: max ${resolved.retrieval.maxParallelReadsPerPage} parallel, ${resolved.retrieval.maxReadWindowLines} lines/window`);

    return lines.join("\n");
  }

  private gatherCapabilities(config: UserEditableConfig): ModelCapability[] {
    const models = new Set<string>();
    for (const role of Object.values(config.roles)) {
      models.add(role.model);
      role.fallback_models.forEach((m) => models.add(m));
    }

    const capabilities: ModelCapability[] = [];
    for (const model of models) {
      const cached = this.capabilityCache.get(model);
      if (cached) {
        capabilities.push(cached);
        continue;
      }
      const provider = this.detectProvider(model, config);
      const cap = getStaticCapabilities(model, provider);
      this.capabilityCache.set(model, cap);
      capabilities.push(cap);
    }

    return capabilities;
  }

  private detectProvider(model: string, config: UserEditableConfig): string {
    if (model.startsWith("claude")) return "anthropic";
    if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) return "openai";
    if (model.startsWith("gemini")) return "google";
    if (model.startsWith("glm")) return "glm";
    // Models with org/ prefix (e.g. "qwen/qwen3.6-plus") — match against
    // configured providers by checking if any provider name appears in the
    // model string or vice versa.
    for (const p of config.providers) {
      if (model.includes(p.provider) || model.startsWith(`${p.provider}/`)) return p.provider;
    }
    return config.providers[0]?.provider ?? "openai-compatible";
  }
}
