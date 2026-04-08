import type { ModelCapability } from "../types/provider.js";

export function buildFallbackChain(
  primaryModel: string,
  fallbackModels: string[],
  capabilities: ModelCapability[],
): string[] {
  const allCandidates = [primaryModel, ...fallbackModels];
  return allCandidates.filter((model) => {
    const cap = capabilities.find((c) => c.model === model);
    return cap ? cap.health !== "unavailable" : false;
  });
}
