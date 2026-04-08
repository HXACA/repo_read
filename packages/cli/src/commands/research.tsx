import * as path from "node:path";
import {
  StorageAdapter,
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

  const config = await loadProjectConfig(storage, slug);
  if (!config) {
    console.error(`No config found for "${slug}". Run "repo-read init" first.`);
    process.exitCode = 1;
    return;
  }

  const providerCenter = new ProviderCenter();
  const resolvedConfig = providerCenter.resolve(config);

  const secretStore = new SecretStore();
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

  console.log(`Researching: "${options.topic}"...`);

  const service = new ResearchService({ model, storage, repoRoot });

  try {
    const result = await service.research(slug, options.topic);

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

    console.log("--- Conclusion ---\n");
    console.log(result.conclusion);

    if (result.allCitations.length > 0) {
      console.log("\nCitations:");
      for (const c of result.allCitations) {
        console.log(`  [${c.kind}] ${c.target}${c.locator ? `:${c.locator}` : ""}`);
      }
    }

    console.log("\nResearch saved to .reporead/projects/" + slug + "/research/");
  } catch (err) {
    console.error(`Research failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
