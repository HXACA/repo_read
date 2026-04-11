import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { StorageAdapter, ProjectModel, saveProjectConfig } from "@reporead/core";
import type { UserEditableConfig } from "@reporead/core";

export interface InitOptions {
  repoRoot: string;
  projectSlug?: string;
}

const FALLBACK_CONFIG: UserEditableConfig = {
  projectSlug: "",
  repoRoot: "",
  preset: "quality",
  language: "zh",
  providers: [
    {
      provider: "anthropic",
      npm: "@ai-sdk/anthropic",
      secretRef: "ANTHROPIC_API_KEY",
      enabled: true,
    },
  ],
  roles: {
    "main.author": {
      model: "anthropic/claude-sonnet-4-6",
      fallback_models: [],
    },
    "fork.worker": {
      model: "anthropic/claude-sonnet-4-6",
      fallback_models: [],
    },
    "fresh.reviewer": {
      model: "anthropic/claude-sonnet-4-6",
      fallback_models: [],
    },
  },
};

/**
 * Load `~/.reporead/config.json` as the base for new projects. If it
 * exists, its providers/roles/language are used instead of the hardcoded
 * fallback. This way users configure their model provider once globally
 * and every `repo-read init` inherits it.
 */
async function loadGlobalConfig(): Promise<Partial<UserEditableConfig>> {
  const globalPath = path.join(os.homedir(), ".reporead", "config.json");
  try {
    const raw = await fs.readFile(globalPath, "utf-8");
    return JSON.parse(raw) as Partial<UserEditableConfig>;
  } catch {
    return {};
  }
}

async function createDefaultConfig(
  slug: string,
  repoRoot: string,
): Promise<UserEditableConfig> {
  const global = await loadGlobalConfig();
  return {
    ...FALLBACK_CONFIG,
    projectSlug: slug,
    repoRoot,
    // Global config overrides
    ...(global.providers ? { providers: global.providers } : {}),
    ...(global.roles ? { roles: global.roles } : {}),
    ...(global.language ? { language: global.language } : {}),
    ...(global.preset ? { preset: global.preset } : {}),
  };
}

export async function runInit(options: InitOptions): Promise<void> {
  const repoRoot = path.resolve(options.repoRoot);
  const slug = options.projectSlug ?? path.basename(repoRoot);

  const storage = new StorageAdapter(repoRoot);
  await storage.initialize();

  const projectModel = new ProjectModel(storage);
  const project = await projectModel.create({
    projectSlug: slug,
    repoRoot,
    branch: "main",
  });

  // Write config — inherits from ~/.reporead/config.json if present
  const config = await createDefaultConfig(slug, repoRoot);
  await saveProjectConfig(storage.paths.projectDir(slug), config);

  await storage.writeJson(storage.paths.currentJson, {
    projectSlug: project.projectSlug,
    repoRoot: project.repoRoot,
  });

  const source = config.providers[0]?.provider ?? "anthropic";
  console.log(`Initialized RepoRead project "${slug}" at ${repoRoot}`);
  console.log(`  Provider: ${source} (from ${config.providers[0]?.apiKey ? "global config" : "default"})`);
  console.log(`  Language: ${config.language ?? "zh"}`);
}
