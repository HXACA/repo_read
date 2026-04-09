import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { AppError } from "../errors.js";
import { parseUserEditableConfig } from "./schema.js";
import type { UserEditableConfig, ProviderCredentialConfig } from "../types/config.js";

export const CONFIG_FILENAME = "config.json";
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), ".reporead");

/** Partial shape for the global config (no projectSlug/repoRoot required) */
type GlobalConfig = {
  language?: string;
  providers?: ProviderCredentialConfig[];
  roles?: UserEditableConfig["roles"];
};

/**
 * Load global config from ~/.reporead/config.json.
 * Returns null if not found (not an error).
 */
async function loadGlobalConfig(): Promise<GlobalConfig | null> {
  const configPath = path.join(GLOBAL_CONFIG_DIR, CONFIG_FILENAME);
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    return JSON.parse(raw) as GlobalConfig;
  } catch {
    return null;
  }
}

/**
 * Merge global config under project config.
 * Project values take precedence. Provider apiKeys from global
 * fill in where the project doesn't specify them.
 */
function mergeConfigs(
  project: UserEditableConfig,
  global: GlobalConfig | null,
): UserEditableConfig {
  if (!global) return project;

  const merged = { ...project };

  // Language: project overrides global
  if (!merged.language && global.language) {
    merged.language = global.language;
  }

  // Roles: project overrides global
  if (!merged.roles && global.roles) {
    merged.roles = global.roles;
  }

  // Providers: merge by provider name.
  // For each project provider, fill in missing apiKey/baseUrl from global.
  if (global.providers) {
    const globalMap = new Map(global.providers.map((p) => [p.provider, p]));

    merged.providers = merged.providers.map((pp) => {
      const gp = globalMap.get(pp.provider);
      if (!gp) return pp;
      return {
        ...pp,
        apiKey: pp.apiKey ?? gp.apiKey,
        baseUrl: pp.baseUrl ?? gp.baseUrl,
      };
    });
  }

  return merged;
}

/**
 * Load project config with global config fallback.
 * Priority: project config.json > ~/.reporead/config.json
 */
export async function loadProjectConfig(
  projectDir: string,
): Promise<UserEditableConfig> {
  const configPath = path.join(projectDir, CONFIG_FILENAME);

  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf-8");
  } catch {
    throw new AppError("CONFIG_NOT_FOUND", `Config not found at ${configPath}`, {
      path: configPath,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("CONFIG_INVALID", `Invalid JSON in ${configPath}`, {
      path: configPath,
    });
  }

  let projectConfig: UserEditableConfig;
  try {
    projectConfig = parseUserEditableConfig(parsed);
  } catch (err) {
    throw new AppError("CONFIG_INVALID", `Config validation failed: ${String(err)}`, {
      path: configPath,
    });
  }

  // Merge with global config
  const global = await loadGlobalConfig();
  return mergeConfigs(projectConfig, global);
}

export async function saveProjectConfig(
  projectDir: string,
  config: UserEditableConfig,
): Promise<void> {
  await fs.mkdir(projectDir, { recursive: true });
  const configPath = path.join(projectDir, CONFIG_FILENAME);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export function getGlobalConfigDir(): string {
  return GLOBAL_CONFIG_DIR;
}
