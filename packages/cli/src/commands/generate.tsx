import * as path from "node:path";
import {
  StorageAdapter,
  ProjectModel,
  profileRepo,
  loadProjectConfig,
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
  const config = await loadProjectConfig(storage, slug);
  if (!config) {
    console.error(`No config found for project "${slug}". Run "repo-read init" first.`);
    process.exitCode = 1;
    return;
  }

  const providerCenter = new ProviderCenter();
  const resolvedConfig = providerCenter.resolve(config);
  console.log(`Config resolved: preset=${resolvedConfig.preset}`);

  // 3. Gather API keys
  const secretStore = new SecretStore();
  const apiKeys: Record<string, string> = {};
  for (const p of resolvedConfig.providers) {
    if (p.enabled) {
      const key = await secretStore.get(p.secretRef);
      if (key) {
        apiKeys[p.provider] = key;
      }
    }
  }

  // 4. Create models
  let model, reviewerModel;
  try {
    model = createModelForRole(resolvedConfig, "main.author", { apiKeys });
    reviewerModel = createModelForRole(resolvedConfig, "fresh.reviewer", { apiKeys });
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
