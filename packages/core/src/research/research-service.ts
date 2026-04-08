import type { LanguageModel } from "ai";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { CitationRecord } from "../types/generation.js";
import { ResearchPlanner } from "./research-planner.js";
import type { ResearchPlan } from "./research-planner.js";
import { ResearchExecutor } from "./research-executor.js";
import type { SubQuestionResult } from "./research-executor.js";

export type ResearchResult = {
  plan: ResearchPlan;
  subResults: SubQuestionResult[];
  conclusion: string;
  allCitations: CitationRecord[];
};

export type ResearchServiceOptions = {
  model: LanguageModel;
  storage: StorageAdapter;
  repoRoot: string;
};

export class ResearchService {
  private readonly planner: ResearchPlanner;
  private readonly executor: ResearchExecutor;
  private readonly storage: StorageAdapter;

  constructor(options: ResearchServiceOptions) {
    this.planner = new ResearchPlanner({ model: options.model, repoRoot: options.repoRoot });
    this.executor = new ResearchExecutor({ model: options.model, repoRoot: options.repoRoot });
    this.storage = options.storage;
  }

  async research(
    projectSlug: string,
    topic: string,
    context?: string,
  ): Promise<ResearchResult> {
    // 1. Plan
    const plan = await this.planner.plan(topic, context);

    // 2. Execute sub-questions sequentially
    const subResults: SubQuestionResult[] = [];
    for (const question of plan.subQuestions) {
      const result = await this.executor.investigate(question);
      subResults.push(result);
    }

    // 3. Aggregate citations
    const allCitations = subResults.flatMap((r) => r.citations);

    // 4. Build conclusion
    const conclusion = this.buildConclusion(plan, subResults);

    // 5. Persist
    await this.persist(projectSlug, plan, subResults, conclusion, allCitations);

    return { plan, subResults, conclusion, allCitations };
  }

  private buildConclusion(plan: ResearchPlan, results: SubQuestionResult[]): string {
    const sections: string[] = [];
    sections.push(`# Research: ${plan.topic}\n`);
    sections.push(`Scope: ${plan.scope}\n`);

    for (const result of results) {
      sections.push(`## ${result.question}\n`);
      for (const finding of result.findings) {
        sections.push(`- ${finding}`);
      }
      if (result.openQuestions.length > 0) {
        sections.push("\nOpen questions:");
        for (const q of result.openQuestions) {
          sections.push(`  - ${q}`);
        }
      }
      sections.push("");
    }

    return sections.join("\n");
  }

  private async persist(
    projectSlug: string,
    plan: ResearchPlan,
    subResults: SubQuestionResult[],
    conclusion: string,
    allCitations: CitationRecord[],
  ): Promise<void> {
    const dir = this.storage.paths.projectDir(projectSlug);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const basePath = `${dir}/research/${timestamp}`;

    await this.storage.writeJson(`${basePath}/plan.json`, plan);
    await this.storage.writeJson(`${basePath}/sub-results.json`, subResults);
    await this.storage.writeJson(`${basePath}/citations.json`, allCitations);

    // Write conclusion as markdown
    const fsModule = await import("node:fs/promises");
    const pathModule = await import("node:path");
    await fsModule.mkdir(pathModule.dirname(`${basePath}/conclusion.md`), { recursive: true });
    await fsModule.writeFile(`${basePath}/conclusion.md`, conclusion, "utf-8");
  }
}
