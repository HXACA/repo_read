import * as path from "node:path";
import {
  StorageAdapter,
  ProjectModel,
  profileRepo,
  loadProjectConfig,
  saveProjectConfig,
  ProviderCenter,
  SecretStore,
  GenerationPipeline,
  JobStateManager,
  createModelForRole,
} from "@reporead/core";

export interface GenerateOptions {
  dir: string;
  name?: string;
}

export async function runGenerate(options: GenerateOptions): Promise<void> {
  const repoRoot = path.resolve(options.dir);
  const storage = new StorageAdapter(repoRoot);
  const projectModel = new ProjectModel(storage);

  // 1. Load project
  const slug = options.name ?? path.basename(repoRoot);
  const project = await projectModel.get(slug);
  if (!project) {
    console.error(`Project "${slug}" not found. Run "repo-read init" first.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Starting generation for "${slug}"...`);

  // 2. Load and resolve config
  let config;
  try {
    config = await loadProjectConfig(storage.paths.projectDir(slug));
  } catch {
    console.error(`No config found for project "${slug}". Run "repo-read init" first.`);
    process.exitCode = 1;
    return;
  }

  const providerCenter = new ProviderCenter();
  const resolvedConfig = providerCenter.resolve(config);
  console.log(`Config resolved: preset=${resolvedConfig.preset}`);

  // 3. Gather API keys — check env vars, then config.apiKey
  const secretStore = new SecretStore({ backend: "env" });
  const apiKeys: Record<string, string> = {};
  let configDirty = false;
  for (const p of config.providers) {
    if (!p.enabled) continue;
    const envKey = await secretStore.get(p.secretRef);
    if (envKey) {
      apiKeys[p.provider] = envKey;
      // Persist env key to config.json so web server can reuse it
      if (!p.apiKey || p.apiKey !== envKey) {
        p.apiKey = envKey;
        configDirty = true;
      }
    } else if (p.apiKey) {
      apiKeys[p.provider] = p.apiKey;
    }
  }
  if (configDirty) {
    await saveProjectConfig(storage.paths.projectDir(slug), config);
    console.log("API key saved to config.json for web server reuse.");
  }

  // 4. Create models for all three roles
  let model, reviewerModel, workerModel;
  try {
    model = createModelForRole(resolvedConfig, "main.author", { apiKeys });
    reviewerModel = createModelForRole(resolvedConfig, "fresh.reviewer", { apiKeys });
    workerModel = createModelForRole(resolvedConfig, "fork.worker", { apiKeys });
  } catch (err) {
    console.error(`Failed to create models: ${(err as Error).message}`);
    console.error("Ensure API keys are set via environment variables or keychain.");
    process.exitCode = 1;
    return;
  }

  // 5. Profile repo
  console.log("Profiling repository...");
  const profile = await profileRepo(repoRoot, slug);
  console.log(`Found ${profile.sourceFileCount} source files, languages: ${profile.languages.join(", ") || "unknown"}`);

  // 6. Get commit hash
  let commitHash = "unknown";
  try {
    const { execSync } = await import("node:child_process");
    commitHash = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf-8" }).trim();
  } catch {
    // Non-git directory, use fallback
  }

  // 7. Create job and run pipeline
  const jobManager = new JobStateManager(storage);
  const job = await jobManager.create(slug, repoRoot, resolvedConfig);
  console.log(`Job ${job.id} created (version: ${job.versionId})`);

  const pipeline = new GenerationPipeline({
    storage,
    jobManager,
    config: resolvedConfig,
    model,
    reviewerModel,
    workerModel,
    repoRoot,
    commitHash,
  });

  console.log("Running generation pipeline...");
  const result = await pipeline.run(job);

  if (result.success) {
    console.log(`\nGeneration complete!`);
    console.log(`  Version: ${result.job.versionId}`);
    console.log(`  Pages: ${result.job.summary.succeededPages ?? 0}/${result.job.summary.totalPages ?? 0}`);
    console.log(`  Status: ${result.job.status}`);
  } else {
    console.error(`\nGeneration failed: ${result.error}`);
    console.error(`  Job: ${result.job.id}`);
    console.error(`  Status: ${result.job.status}`);
    process.exitCode = 1;
  }
}
