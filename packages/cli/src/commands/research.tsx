import * as path from "node:path";
import {
  StorageAdapter,
  ProjectModel,
  loadProjectConfig,
  ProviderCenter,
  SecretStore,
  createModelForRole,
  ResearchService,
} from "@reporead/core";

export interface ResearchOptions {
  dir: string;
  name?: string;
  topic: string;
}

export async function runResearch(options: ResearchOptions): Promise<void> {
  const repoRoot = path.resolve(options.dir);
  const slug = options.name ?? path.basename(repoRoot);
  const storage = new StorageAdapter(repoRoot);

  let config;
  try {
    config = await loadProjectConfig(storage.paths.projectDir(slug));
  } catch {
    console.error(`No config found for "${slug}". Run "repo-read init" first.`);
    process.exitCode = 1;
    return;
  }

  const providerCenter = new ProviderCenter();
  const resolvedConfig = providerCenter.resolve(config);

  const secretStore = new SecretStore({ backend: "env" });
  const apiKeys: Record<string, string> = {};
  for (const p of resolvedConfig.providers) {
    if (p.enabled) {
      const key = await secretStore.get(p.secretRef);
      if (key) apiKeys[p.provider] = key;
    }
  }

  let model;
  try {
    model = createModelForRole(resolvedConfig, "main.author", { apiKeys });
  } catch (err) {
    console.error(`Failed to create model: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  // Resolve current version for this project (research notes are
  // versioned so they can be viewed alongside the wiki they reference).
  const projectModel = new ProjectModel(storage);
  const project = await projectModel.get(slug);
  const versionId = project?.latestVersionId;
  if (!versionId) {
    console.error(
      `Project "${slug}" has no published version. Run "repo-read generate" first.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Researching: "${options.topic}" (version ${versionId})...`);

  // Planner gets roughly half the executor budget — it's lightweight and
  // only needs a few tool calls to understand high-level structure.
  const researchBudget = resolvedConfig.qualityProfile.researchMaxSteps;
  const service = new ResearchService({
    model,
    storage,
    repoRoot,
    plannerMaxSteps: Math.max(3, Math.ceil(researchBudget / 2)),
    executorMaxSteps: researchBudget,
  });

  try {
    const result = await service.research(slug, versionId, options.topic);
    const note = result.note;

    console.log(`\nResearch Plan: ${result.plan.scope}`);
    console.log(`Sub-questions: ${result.plan.subQuestions.length}\n`);

    for (const sub of result.subResults) {
      console.log(`  Q: ${sub.question}`);
      for (const f of sub.findings) {
        console.log(`    - ${f}`);
      }
      if (sub.openQuestions.length > 0) {
        console.log(`    Open: ${sub.openQuestions.join(", ")}`);
      }
      console.log();
    }

    console.log("--- Synthesis ---\n");
    console.log(`事实 (facts): ${note.facts.length}`);
    for (const f of note.facts) {
      console.log(`  ✓ ${f.statement}`);
      for (const c of f.citations) {
        console.log(`     [${c.kind}] ${c.target}${c.locator ? `:${c.locator}` : ""}`);
      }
    }
    console.log(`\n推断 (inferences): ${note.inferences.length}`);
    for (const f of note.inferences) {
      console.log(`  ~ ${f.statement}`);
    }
    console.log(`\n待确认 (unconfirmed): ${note.unconfirmed.length}`);
    for (const f of note.unconfirmed) {
      console.log(`  ? ${f.statement}`);
    }

    console.log("\n--- Summary ---\n");
    console.log(note.summary);

    console.log(
      `\nResearch note saved: .reporead/projects/${slug}/research/${versionId}/${note.id}.json`,
    );
  } catch (err) {
    console.error(`Research failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
