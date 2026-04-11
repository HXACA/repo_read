import type { UserEditableConfig, ResolvedConfig, RoleName } from "../types/config.js";
import { parseModelId } from "../types/config.js";
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
    for (const fullModelId of models) {
      const cached = this.capabilityCache.get(fullModelId);
      if (cached) {
        capabilities.push(cached);
        continue;
      }
      // Provider comes from "provider/model" prefix, or fallback to first config provider
      const { provider: modelProvider, model: bareModel } = parseModelId(fullModelId);
      const provider = modelProvider ?? config.providers[0]?.provider ?? "openai-compatible";
      const cap = getStaticCapabilities(bareModel, provider);
      this.capabilityCache.set(fullModelId, cap);
      capabilities.push(cap);
    }

    return capabilities;
  }
}
