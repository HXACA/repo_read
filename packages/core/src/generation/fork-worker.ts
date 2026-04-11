import type { LanguageModel, ToolSet } from "ai";
import { generateViaStream as generateText } from "../utils/generate-via-stream.js";
import type { ForkWorkerResult } from "../types/agent.js";
import { buildForkWorkerSystemPrompt, buildForkWorkerUserPrompt } from "./fork-worker-prompt.js";
import type { ForkWorkerInput } from "./fork-worker-prompt.js";
import { createCatalogTools } from "../catalog/catalog-tools.js";

export type ForkWorkerResponse = {
  success: boolean;
  data?: ForkWorkerResult;
  error?: string;
};

export type ForkWorkerOptions = {
  model: LanguageModel;
  repoRoot: string;
};

export class ForkWorker {
  private readonly model: LanguageModel;
  private readonly repoRoot: string;

  constructor(options: ForkWorkerOptions) {
    this.model = options.model;
    this.repoRoot = options.repoRoot;
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
      });

      return this.parseOutput(result.text);
    } catch (err) {
      return { success: false, error: `Fork worker failed: ${(err as Error).message}` };
    }
  }

  private parseOutput(text: string): ForkWorkerResponse {
    let jsonStr = text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    try {
      const data = JSON.parse(jsonStr);
      if (!data.directive || !Array.isArray(data.findings)) {
        return { success: false, error: "Invalid fork worker output: missing directive or findings" };
      }
      return {
        success: true,
        data: {
          directive: data.directive,
          findings: data.findings,
          citations: (data.citations ?? []).map((c: Record<string, string>) => ({
            kind: c.kind ?? "file",
            target: c.target,
            locator: c.locator,
            note: c.note,
          })),
          open_questions: data.open_questions ?? [],
        },
      };
    } catch {
      return { success: false, error: "Failed to parse fork worker output as JSON" };
    }
  }
}
