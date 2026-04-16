import * as path from "node:path";
import * as fs from "node:fs";
import {
  StorageAdapter,
  ProjectModel,
  profileRepo,
  loadProjectConfig,
  ProviderCenter,
  resolveApiKeys,
  GenerationPipeline,
  JobStateManager,
  createModelForRole,
  setDebugDir,
  UsageTracker,
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
  /** Placeholder for incremental regeneration (not yet wired up). */
  incremental?: boolean;
  /** Override qp.pageConcurrency (1-5). CLI flag validates the range. */
  pageConcurrency?: number;
}

export async function runGenerate(options: GenerateOptions): Promise<void> {
  if (options.incremental) {
    console.log("Incremental mode is not yet implemented — proceeding with full generation.");
  }

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

  // CLI override: --page-concurrency replaces qp.pageConcurrency (if set).
  if (options.pageConcurrency != null) {
    resolvedConfig.qualityProfile = {
      ...resolvedConfig.qualityProfile,
      pageConcurrency: options.pageConcurrency,
    };
  }

  console.log(
    `Config resolved: preset=${resolvedConfig.preset} pageConcurrency=${resolvedConfig.qualityProfile.pageConcurrency}`,
  );

  // 3. Gather API keys — env var > config.apiKey
  const apiKeys = resolveApiKeys(config);

  // 3b. Enable debug fetch injection (actual dir set after job creation)
  const isDebug = process.env.REPOREAD_DEBUG === "1" || process.env.REPOREAD_DEBUG === "true";
  if (isDebug) setDebugDir(path.join(storage.paths.projectDir(slug), "debug"));

  // 4. Create models for all five roles
  let catalogModel, outlineModel, drafterModel, workerModel, reviewerModel;
  try {
    catalogModel = createModelForRole(resolvedConfig, "catalog", { apiKeys });
    outlineModel = createModelForRole(resolvedConfig, "outline", { apiKeys });
    drafterModel = createModelForRole(resolvedConfig, "drafter", { apiKeys });
    workerModel = createModelForRole(resolvedConfig, "worker", { apiKeys });
    reviewerModel = createModelForRole(resolvedConfig, "reviewer", { apiKeys });
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
  let repoProfile: Awaited<ReturnType<typeof profileRepo>> | undefined;

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
    repoProfile = await profileRepo(repoRoot, slug);
    console.log(
      `Found ${repoProfile.sourceFileCount} source files, languages: ${repoProfile.languages.join(", ") || "unknown"}`,
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

  const usageTracker = new UsageTracker();
  const pipeline = new GenerationPipeline({
    storage,
    jobManager,
    config: resolvedConfig,
    catalogModel,
    outlineModel,
    drafterModel,
    workerModel,
    reviewerModel,
    repoRoot,
    commitHash,
    usageTracker,
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
    // Pass the profile we already computed so the pipeline skips a duplicate
    // profileRepo() call during catalog planning.
    ...(repoProfile ? { repoProfile } : {}),
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

  if (result.usageTracker) {
    console.log(result.usageTracker.formatDisplay());
    console.log();
  }

  if (!result.success) {
    process.exitCode = 1;
  }
}
