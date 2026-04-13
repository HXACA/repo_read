import type { LanguageModel, ToolSet } from "ai";
import type { StepInfo } from "../agent/agent-loop.js";
import type { RepoProfile } from "../types/project.js";
import type { WikiJson } from "../types/generation.js";
import { buildCatalogSystemPrompt, buildCatalogUserPrompt } from "./catalog-prompt.js";
import { createCatalogTools } from "./catalog-tools.js";
import { extractJson } from "../utils/extract-json.js";
import { PromptAssembler } from "../prompt/assembler.js";
import { TurnEngineAdapter } from "../runtime/turn-engine.js";
import type { ProviderCallOptions } from "../utils/generate-via-stream.js";

export type CatalogPlannerOptions = {
  model: LanguageModel;
  language: string;
  maxSteps?: number;
  maxRetries?: number;
  allowBash?: boolean;
  providerCallOptions?: ProviderCallOptions;
  onStep?: (step: StepInfo) => void;
};

export type CatalogPlanResult = {
  success: boolean;
  wiki?: WikiJson;
  error?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
};

export class CatalogPlanner {
  private readonly model: LanguageModel;
  private readonly language: string;
  private readonly maxSteps: number;
  private readonly maxRetries: number;
  private readonly allowBash: boolean;
  private readonly providerCallOptions?: ProviderCallOptions;
  private readonly onStep?: (step: StepInfo) => void;
  private readonly promptAssembler: PromptAssembler;
  private readonly turnEngine: TurnEngineAdapter;

  constructor(options: CatalogPlannerOptions) {
    this.model = options.model;
    this.language = options.language;
    this.maxSteps = options.maxSteps ?? 20;
    this.maxRetries = options.maxRetries ?? 3;
    this.allowBash = options.allowBash ?? true;
    this.providerCallOptions = options.providerCallOptions;
    this.onStep = options.onStep;
    this.promptAssembler = new PromptAssembler();
    this.turnEngine = new TurnEngineAdapter();
  }

  async plan(profile: RepoProfile): Promise<CatalogPlanResult> {
    const systemPrompt = buildCatalogSystemPrompt();
    const tools = createCatalogTools(profile.repoRoot, { allowBash: this.allowBash });

    let lastError = "";
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        // On retry, append the previous error so the model knows what went wrong
        let userPrompt = buildCatalogUserPrompt(profile, this.language);
        if (attempt > 0 && lastError) {
          userPrompt += `\n\n## Previous Attempt Failed (attempt ${attempt}/${this.maxRetries})\n\nError: ${lastError}\n\nPlease fix the issue and output a valid JSON object with "summary" and "reading_order" fields. Output ONLY the JSON object.`;
        }

        const assembled = this.promptAssembler.assemble({ role: "catalog", language: this.language, systemPrompt, userPrompt });
        const result = await this.turnEngine.run({
          purpose: "catalog",
          model: this.model,
          systemPrompt: assembled.system,
          userPrompt: assembled.user,
          tools: tools as unknown as ToolSet,
          policy: {
            maxSteps: this.maxSteps,
            retry: { maxRetries: 0, baseDelayMs: 0, backoffFactor: 1 },
            overflow: { strategy: "none" },
            toolBatch: { strategy: "sequential" },
            providerOptions: this.providerCallOptions,
          },
          onStep: this.onStep,
        });

        const wiki = this.parseWikiJson(result.text);

        return {
          success: true,
          wiki,
          usage: {
            promptTokens: result.usage.inputTokens,
            completionTokens: result.usage.outputTokens,
            totalTokens: result.usage.inputTokens + result.usage.outputTokens,
          },
        };
      } catch (err) {
        lastError = (err as Error).message;
      }
    }
    return { success: false, error: `Catalog planning failed after ${this.maxRetries} attempts: ${lastError}` };
  }

  private parseWikiJson(text: string): WikiJson {
    const parsed = extractJson(text);
    if (!parsed || !parsed.summary || !Array.isArray(parsed.reading_order)) {
      throw new Error(`Invalid wiki.json structure: missing summary or reading_order. Model output was ${text.length} chars: "${text.slice(0, 200)}"`);
    }
    return parsed as unknown as WikiJson;
  }
}
