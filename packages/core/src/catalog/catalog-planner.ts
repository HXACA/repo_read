import type { LanguageModel, ToolSet } from "ai";
import type { StepInfo } from "../agent/agent-loop.js";
import type { RepoProfile } from "../types/project.js";
import type { WikiJson } from "../types/generation.js";
import type { UsageInput } from "../utils/usage-tracker.js";
import { buildCatalogSystemPrompt, buildCatalogUserPrompt } from "./catalog-prompt.js";
import { createCatalogTools } from "./catalog-tools.js";
import { extractJson } from "../utils/extract-json.js";
import { PromptAssembler } from "../prompt/assembler.js";
import { TurnEngineAdapter } from "../runtime/turn-engine.js";
import type { ProviderCallOptions } from "../runtime/turn-types.js";

export type CatalogPlannerOptions = {
  model: LanguageModel;
  language: string;
  maxSteps?: number;
  maxRetries?: number;
  allowBash?: boolean;
  providerCallOptions?: ProviderCallOptions;
  onStep?: (step: StepInfo) => void;
  /**
   * Fires when a single attempt inside `plan()` throws (turn engine error,
   * aborted fetch, unparseable wiki.json, etc.). Called once per failed
   * attempt BEFORE the retry. The planner will still keep retrying until
   * `maxRetries` is exhausted — use this hook to surface progress so UI /
   * events.ndjson don't go silent during long retries (the common failure
   * before this hook existed was an overnight macOS App Nap suspending
   * catalog, where the user saw only a spinner until the whole job failed).
   *
   * Non-throwing by contract: the planner wraps this call in try/catch.
   */
  onAttemptFailed?: (attempt: number, maxRetries: number, error: string) => void;
};

export type CatalogPlanResult = {
  success: boolean;
  wiki?: WikiJson;
  error?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  metrics?: { llmCalls: number; usage: UsageInput };
};

export class CatalogPlanner {
  private readonly model: LanguageModel;
  private readonly language: string;
  private readonly maxSteps: number;
  private readonly maxRetries: number;
  private readonly allowBash: boolean;
  private readonly providerCallOptions?: ProviderCallOptions;
  private readonly onStep?: (step: StepInfo) => void;
  private readonly onAttemptFailed?: (attempt: number, maxRetries: number, error: string) => void;
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
    this.onAttemptFailed = options.onAttemptFailed;
    this.promptAssembler = new PromptAssembler();
    this.turnEngine = new TurnEngineAdapter();
  }

  async plan(profile: RepoProfile): Promise<CatalogPlanResult> {
    const systemPrompt = buildCatalogSystemPrompt();
    const tools = createCatalogTools(profile.repoRoot, { allowBash: this.allowBash });

    let lastError = "";
    // Accumulate metrics across retry attempts so failures still report total cost
    const totalMetrics = { llmCalls: 0, usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 } };

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        let userPrompt = buildCatalogUserPrompt(profile, this.language);
        if (attempt > 0 && lastError) {
          userPrompt += `\n\n## Previous Attempt Failed (attempt ${attempt}/${this.maxRetries})\n\nError: ${lastError}\n\nPlease fix the issue and output a valid JSON object with "summary" and "reading_order" fields. Each page in reading_order MUST include:\n- "kind": one of "guide", "explanation", "reference", "appendix"\n- "readerGoal": one sentence describing what the reader gains\n- "prerequisites": array of slugs this page depends on (can be empty [])\n\nOutput ONLY the JSON object.`;
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
            providerOptions: this.providerCallOptions,
          },
          onStep: this.onStep,
        });

        // Accumulate this attempt's cost
        totalMetrics.llmCalls += 1;
        totalMetrics.usage.inputTokens += result.usage.inputTokens;
        totalMetrics.usage.outputTokens += result.usage.outputTokens;
        totalMetrics.usage.reasoningTokens += result.usage.reasoningTokens;
        totalMetrics.usage.cachedTokens += result.usage.cachedTokens;

        const wiki = this.parseWikiJson(result.text);

        return {
          success: true,
          wiki,
          usage: {
            promptTokens: totalMetrics.usage.inputTokens,
            completionTokens: totalMetrics.usage.outputTokens,
            totalTokens: totalMetrics.usage.inputTokens + totalMetrics.usage.outputTokens,
          },
          metrics: totalMetrics,
        };
      } catch (err) {
        lastError = (err as Error).message;
        // The turnEngine call succeeded (it returned a result) but parsing failed,
        // or it threw — either way the LLM cost was already accumulated above if
        // we got past the run() call. If run() itself threw, no cost to record.
        //
        // Surface the failure via onAttemptFailed so the pipeline can emit an
        // observable event. Without this hook the retry loop is silent — the
        // overnight CubeSandbox run stuck an entire session because one attempt
        // was mid-fetch when macOS App Nap suspended the process, the wake
        // detector aborted the fetch, and this catch block swallowed the
        // AbortError with no user-visible signal.
        if (this.onAttemptFailed) {
          try { this.onAttemptFailed(attempt + 1, this.maxRetries, lastError); }
          catch { /* best-effort */ }
        }
      }
    }
    return {
      success: false,
      error: `Catalog planning failed after ${this.maxRetries} attempts: ${lastError}`,
      metrics: totalMetrics,
    };
  }

  private parseWikiJson(text: string): WikiJson {
    const parsed = extractJson(text);
    if (!parsed || !parsed.summary || !Array.isArray(parsed.reading_order)) {
      throw new Error(`Invalid wiki.json structure: missing summary or reading_order. Model output was ${text.length} chars: "${text.slice(0, 200)}"`);
    }
    return parsed as unknown as WikiJson;
  }
}
