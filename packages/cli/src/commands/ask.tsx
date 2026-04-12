import * as path from "node:path";
import * as readline from "node:readline/promises";
import {
  StorageAdapter,
  loadProjectConfig,
  ProviderCenter,
  resolveApiKeys,
  createModelForRole,
  AskService,
} from "@reporead/core";

export interface AskOptions {
  dir: string;
  name?: string;
  page?: string;
  question?: string;
}

export async function runAsk(options: AskOptions): Promise<void> {
  const repoRoot = path.resolve(options.dir);
  const slug = options.name ?? path.basename(repoRoot);
  const storage = new StorageAdapter(repoRoot);

  // Load config and create model
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

  const apiKeys = resolveApiKeys(config);

  let model;
  try {
    model = createModelForRole(resolvedConfig, "drafter", { apiKeys });
  } catch (err) {
    console.error(`Failed to create model: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  // Get current version
  const current = await storage.readJson<{ versionId?: string }>(storage.paths.currentJson);
  if (!current?.versionId) {
    console.error('No published version. Run "repo-read generate" first.');
    process.exitCode = 1;
    return;
  }

  const service = new AskService({
    model,
    storage,
    repoRoot,
    qualityProfile: resolvedConfig.qualityProfile,
  });
  let sessionId: string | undefined;

  // Single question mode
  if (options.question) {
    const result = await service.ask(slug, current.versionId, options.question, {
      currentPageSlug: options.page,
      sessionId,
    });
    console.log(`\n${result.answer}`);
    if (result.citations.length > 0) {
      console.log("\nCitations:");
      for (const c of result.citations) {
        console.log(`  [${c.kind}] ${c.target}${c.locator ? `:${c.locator}` : ""}`);
      }
    }
    return;
  }

  // Interactive mode
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`Ask questions about "${slug}" (version: ${current.versionId}). Type "exit" to quit.\n`);

  try {
    while (true) {
      const question = await rl.question("You: ");
      if (question.trim().toLowerCase() === "exit") break;
      if (!question.trim()) continue;

      const result = await service.ask(slug, current.versionId, question, {
        currentPageSlug: options.page,
        sessionId,
      });
      sessionId = result.sessionId;

      console.log(`\nAssistant: ${result.answer}`);
      if (result.citations.length > 0) {
        console.log("\nCitations:");
        for (const c of result.citations) {
          console.log(`  [${c.kind}] ${c.target}${c.locator ? `:${c.locator}` : ""}`);
        }
      }
      console.log();
    }
  } finally {
    rl.close();
  }
}
