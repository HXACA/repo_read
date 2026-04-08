import * as path from "node:path";
import { StorageAdapter, ProjectModel } from "@reporead/core";

export interface InitOptions {
  repoRoot: string;
  projectSlug?: string;
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

  await storage.writeJson(storage.paths.currentJson, {
    projectSlug: project.projectSlug,
    repoRoot: project.repoRoot,
  });

  console.log(`Initialized RepoRead project "${slug}" at ${repoRoot}`);
}
