import * as path from "node:path";
import { StorageAdapter, ProjectModel, saveProjectConfig } from "@reporead/core";
import type { UserEditableConfig } from "@reporead/core";

export interface InitOptions {
  repoRoot: string;
  projectSlug?: string;
}

function createDefaultConfig(slug: string, repoRoot: string): UserEditableConfig {
  return {
    projectSlug: slug,
    repoRoot,
    preset: "quality",
    providers: [
      {
        provider: "anthropic",
        secretRef: "ANTHROPIC_API_KEY",
        enabled: true,
      },
    ],
    roles: {
      "main.author": {
        model: "claude-sonnet-4-6",
        fallback_models: ["claude-haiku-4-5-20251001"],
      },
      "fork.worker": {
        model: "claude-haiku-4-5-20251001",
        fallback_models: [],
      },
      "fresh.reviewer": {
        model: "claude-sonnet-4-6",
        fallback_models: ["claude-haiku-4-5-20251001"],
      },
    },
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

  // Write default config
  const config = createDefaultConfig(slug, repoRoot);
  await saveProjectConfig(storage.paths.projectDir(slug), config);

  await storage.writeJson(storage.paths.currentJson, {
    projectSlug: project.projectSlug,
    repoRoot: project.repoRoot,
  });

  console.log(`Initialized RepoRead project "${slug}" at ${repoRoot}`);
}
