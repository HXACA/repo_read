import type { LanguageModel, ToolSet } from "ai";
import type { StepInfo } from "../agent/agent-loop.js";
import type { ForkWorkerResult } from "../types/agent.js";
import type { CitationKind } from "../types/generation.js";
import { buildForkWorkerSystemPrompt, buildForkWorkerUserPrompt } from "./fork-worker-prompt.js";
import type { ForkWorkerInput } from "./fork-worker-prompt.js";
import { createCatalogTools } from "../catalog/catalog-tools.js";
import { extractJson } from "../utils/extract-json.js";
import { PromptAssembler } from "../prompt/assembler.js";
import { TurnEngineAdapter } from "../runtime/turn-engine.js";

export type ForkWorkerResponse = {
  success: boolean;
  data?: ForkWorkerResult;
  error?: string;
};

export type ForkWorkerOptions = {
  model: LanguageModel;
  repoRoot: string;
  maxSteps?: number;
  allowBash?: boolean;
  onStep?: (step: StepInfo) => void;
};

export class ForkWorker {
  private readonly model: LanguageModel;
  private readonly repoRoot: string;
  private readonly maxSteps: number;
  private readonly allowBash: boolean;
  private readonly onStep?: (step: StepInfo) => void;
  private readonly promptAssembler: PromptAssembler;
  private readonly turnEngine: TurnEngineAdapter;

  constructor(options: ForkWorkerOptions) {
    this.model = options.model;
    this.repoRoot = options.repoRoot;
    this.maxSteps = options.maxSteps ?? 8;
    this.allowBash = options.allowBash ?? true;
    this.onStep = options.onStep;
    this.promptAssembler = new PromptAssembler();
    this.turnEngine = new TurnEngineAdapter();
  }

  async execute(input: ForkWorkerInput): Promise<ForkWorkerResponse> {
    const systemPrompt = buildForkWorkerSystemPrompt();
    const userPrompt = buildForkWorkerUserPrompt(input);
    const tools = createCatalogTools(this.repoRoot, { allowBash: this.allowBash });

    try {
      const assembled = this.promptAssembler.assemble({ role: "worker", language: "en", systemPrompt, userPrompt });
      const result = await this.turnEngine.run({
        purpose: "worker",
        model: this.model,
        systemPrompt: assembled.system,
        userPrompt: assembled.user,
        tools: tools as unknown as ToolSet,
        policy: {
          maxSteps: this.maxSteps,
          retry: { maxRetries: 0, baseDelayMs: 0, backoffFactor: 1 },
          overflow: { strategy: "none" },
          toolBatch: { strategy: "sequential" },
        },
        onStep: this.onStep,
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
