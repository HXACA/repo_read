import { stepCountIs } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import { generateViaStream as generateText } from "../utils/generate-via-stream.js";
import type { ForkWorkerResult } from "../types/agent.js";
import type { CitationKind } from "../types/generation.js";
import { buildForkWorkerSystemPrompt, buildForkWorkerUserPrompt } from "./fork-worker-prompt.js";
import type { ForkWorkerInput } from "./fork-worker-prompt.js";
import { createCatalogTools } from "../catalog/catalog-tools.js";
import { extractJson } from "../utils/extract-json.js";

export type ForkWorkerResponse = {
  success: boolean;
  data?: ForkWorkerResult;
  error?: string;
};

export type ForkWorkerOptions = {
  model: LanguageModel;
  repoRoot: string;
  maxSteps?: number;
};

export class ForkWorker {
  private readonly model: LanguageModel;
  private readonly repoRoot: string;
  private readonly maxSteps: number;

  constructor(options: ForkWorkerOptions) {
    this.model = options.model;
    this.repoRoot = options.repoRoot;
    this.maxSteps = options.maxSteps ?? 8;
  }

  async execute(input: ForkWorkerInput): Promise<ForkWorkerResponse> {
    const systemPrompt = buildForkWorkerSystemPrompt();
    const userPrompt = buildForkWorkerUserPrompt(input);
    const tools = createCatalogTools(this.repoRoot);

    try {
      const result = await generateText({
        model: this.model,
        system: systemPrompt,
        prompt: userPrompt,
        tools: tools as unknown as ToolSet,
        stopWhen: stepCountIs(this.maxSteps),
      });

      return this.parseOutput(result.text);
    } catch (err) {
      return { success: false, error: `Fork worker failed: ${(err as Error).message}` };
    }
  }

  private parseOutput(text: string): ForkWorkerResponse {
    const data = extractJson(text);
    if (!data || !data.directive || !Array.isArray(data.findings)) {
      return { success: false, error: "Invalid fork worker output: missing directive or findings" };
    }
    return {
      success: true,
      data: {
        directive: data.directive as string,
        findings: data.findings as string[],
        citations: (Array.isArray(data.citations) ? data.citations : []).map((c: Record<string, string>) => ({
          kind: (c.kind ?? "file") as CitationKind,
          target: c.target,
          locator: c.locator,
          note: c.note,
        })),
        open_questions: (data.open_questions as string[]) ?? [],
      },
    };
  }
}
