import * as path from "node:path";
import * as fs from "node:fs";
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
  setDebugDir,
} from "@reporead/core";
import type {
  GenerationJob,
  WikiJson,
  PageMeta,
} from "@reporead/core";
import { ProgressRenderer } from "../progress-renderer.js";

export interface GenerateOptions {
  dir: string;
  name?: string;
  /** Resume a previously failed/interrupted job by id. */
  resume?: string;
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

  // 3b. Enable debug fetch injection (actual dir set after job creation)
  const isDebug = process.env.REPOREAD_DEBUG === "1" || process.env.REPOREAD_DEBUG === "true";
  if (isDebug) setDebugDir(path.join(storage.paths.projectDir(slug), "debug"));

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

  const jobManager = new JobStateManager(storage);

  // 5. Either resume an existing job or create a new one
  let job: GenerationJob;
  let resumeWith: { wiki: WikiJson; skipPageSlugs: Set<string> } | undefined;
  let commitHash = "unknown";

  if (options.resume) {
    // --- RESUME PATH ---
    const existing = await jobManager.get(slug, options.resume);
    if (!existing) {
      console.error(`Job "${options.resume}" not found in project "${slug}".`);
      process.exitCode = 1;
      return;
    }
    if (existing.status === "completed") {
      console.error(
        `Job "${options.resume}" is already completed. Nothing to resume.`,
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      `Resuming job ${existing.id} (version ${existing.versionId}, status=${existing.status})`,
    );

    // Load the wiki.json that was persisted when the original job ran
    // through catalog. If it doesn't exist, catalog never finished — we
    // can't resume the page loop without a plan.
    const wiki = await storage.readJson<WikiJson>(
      storage.paths.draftWikiJson(slug, existing.id, existing.versionId),
    );
    if (!wiki) {
      console.error(
        `Job "${existing.id}" has no draft wiki.json — catalog never completed. Run without --resume.`,
      );
      process.exitCode = 1;
      return;
    }

    // Walk the reading order and find pages that already have a validated
    // meta file. Those are the ones we should skip. Also grab the
    // commitHash from the first available meta file so subsequent pages
    // stay consistent with the original run's commit basis.
    const skipPageSlugs = new Set<string>();
    let recoveredCommitHash: string | null = null;
    for (const page of wiki.reading_order) {
      const meta = await storage.readJson<PageMeta>(
        storage.paths.draftPageMeta(
          slug,
          existing.id,
          existing.versionId,
          page.slug,
        ),
      );
      // Consider a page done if its meta file exists and declares
      // status="validated". Anything else needs to be re-drafted.
      if (meta && meta.status === "validated") {
        skipPageSlugs.add(page.slug);
        if (!recoveredCommitHash && meta.commitHash) {
          recoveredCommitHash = meta.commitHash;
        }
      }
    }

    const alreadyDone = skipPageSlugs.size;
    const remaining = wiki.reading_order.length - alreadyDone;
    console.log(
      `Resume plan: ${alreadyDone} pages already validated, ${remaining} remaining`,
    );
    if (remaining === 0) {
      console.error(
        `All pages are already validated for job "${existing.id}". Nothing to do — consider running without --resume to publish.`,
      );
      process.exitCode = 1;
      return;
    }

    // Reuse the recovered commit hash to keep citations consistent with
    // the original run. Fall back to re-reading HEAD if no meta file
    // provided one.
    if (recoveredCommitHash) {
      commitHash = recoveredCommitHash;
    } else {
      try {
        const { execSync } = await import("node:child_process");
        commitHash = execSync("git rev-parse HEAD", {
          cwd: repoRoot,
          encoding: "utf-8",
        }).trim();
      } catch {
        /* non-git directory */
      }
    }

    job = existing;
    resumeWith = { wiki, skipPageSlugs };
  } else {
    // --- FRESH GENERATION PATH ---
    console.log("Profiling repository...");
    const profile = await profileRepo(repoRoot, slug);
    console.log(
      `Found ${profile.sourceFileCount} source files, languages: ${profile.languages.join(", ") || "unknown"}`,
    );

    try {
      const { execSync } = await import("node:child_process");
      commitHash = execSync("git rev-parse HEAD", {
        cwd: repoRoot,
        encoding: "utf-8",
      }).trim();
    } catch {
      /* non-git directory */
    }

    job = await jobManager.create(slug, repoRoot, resolvedConfig);
    console.log(`Job ${job.id} created (version: ${job.versionId})`);
  }

  // Update debug dir to job-specific path now that we have the job ID
  if (isDebug) setDebugDir(path.join(storage.paths.jobDir(slug, job.id), "debug"));

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

  const progress = new ProgressRenderer();

  if (resumeWith) {
    progress.setPageList(
      resumeWith.wiki.reading_order.map((p) => ({
        slug: p.slug,
        title: p.title,
        section: p.section,
      })),
    );
    progress.setResumeSkipped(resumeWith.skipPageSlugs.size);
  }

  console.log();
  progress.start();
  const result = await pipeline.run(job, {
    ...(resumeWith ? { resumeWith } : {}),
    onEvent: (event) => {
      // On catalog.completed, read the wiki.json to populate the page list
      // for fresh generation (resume already has it from the CLI).
      if (event.type === "catalog.completed" && !resumeWith) {
        try {
          const wikiPath = storage.paths.draftWikiJson(slug, job.id, job.versionId);
          const wiki = JSON.parse(fs.readFileSync(wikiPath, "utf-8")) as WikiJson;
          progress.setPageList(
            wiki.reading_order.map((pg) => ({
              slug: pg.slug,
              title: pg.title,
              section: pg.section,
            })),
          );
        } catch {
          // Fallback: renderer will show slugs instead of titles
        }
      }
      progress.onEvent(event);
    },
  });

  progress.printSummary(result.success, result.job);

  if (!result.success) {
    process.exitCode = 1;
  }
}
