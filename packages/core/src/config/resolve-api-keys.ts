import type { UserEditableConfig } from "../types/config.js";

/**
 * Resolve API keys for all enabled providers.
 * Priority: env var (via secretRef) > config.apiKey.
 * Used by generate, ask, research, doctor, and Web ask route.
 */
export function resolveApiKeys(config: UserEditableConfig): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const p of config.providers) {
    if (!p.enabled) continue;
    const envKey = process.env[p.secretRef] ?? null;
    if (envKey) {
      keys[p.provider] = envKey;
    } else if (p.apiKey) {
      keys[p.provider] = p.apiKey;
    }
  }
  return keys;
}
