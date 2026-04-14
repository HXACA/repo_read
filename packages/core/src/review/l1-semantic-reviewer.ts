import type { LanguageModel } from "ai";
import type { StepInfo } from "../agent/agent-loop.js";
import type { ReviewBriefing } from "../types/review.js";
import type { ReviewerStrictness } from "./reviewer-prompt.js";
import { buildL1SystemPrompt, buildL1UserPrompt } from "./l1-semantic-prompt.js";
import { extractJson } from "../utils/extract-json.js";
import { PromptAssembler } from "../prompt/assembler.js";
import { TurnEngineAdapter } from "../runtime/turn-engine.js";
import type { ProviderCallOptions } from "../runtime/turn-types.js";
import type { ReviewResult } from "./reviewer.js";

export type L1SemanticReviewerOptions = {
  model: LanguageModel;
  strictness?: ReviewerStrictness;
  providerCallOptions?: ProviderCallOptions;
  onStep?: (step: StepInfo) => void;
};

export class L1SemanticReviewer {
  private readonly model: LanguageModel;
  private readonly strictness: ReviewerStrictness;
  private readonly providerCallOptions?: ProviderCallOptions;
  private readonly onStep?: (step: StepInfo) => void;
  private readonly promptAssembler: PromptAssembler;
  private readonly turnEngine: TurnEngineAdapter;

  constructor(options: L1SemanticReviewerOptions) {
    this.model = options.model;
    this.strictness = options.strictness ?? "normal";
    this.providerCallOptions = options.providerCallOptions;
    this.onStep = options.onStep;
    this.promptAssembler = new PromptAssembler();
    this.turnEngine = new TurnEngineAdapter();
  }

  async review(briefing: ReviewBriefing, draftContent: string): Promise<ReviewResult> {
    const systemPrompt = buildL1SystemPrompt(this.strictness);
    const userPrompt = buildL1UserPrompt(briefing, draftContent);

    try {
      const assembled = this.promptAssembler.assemble({
        role: "reviewer",
        language: "en",
        systemPrompt,
        userPrompt,
      });
      const result = await this.turnEngine.run({
        purpose: "review-l1",
        model: this.model,
        systemPrompt: assembled.system,
        userPrompt: assembled.user,
        tools: {},
        policy: {
          maxSteps: 1,
          providerOptions: this.providerCallOptions,
        },
        onStep: this.onStep,
      });

      return {
        ...this.parseOutput(result.text),
        metrics: {
          llmCalls: 1,
          usage: {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            reasoningTokens: result.usage.reasoningTokens,
            cachedTokens: result.usage.cachedTokens,
          },
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `L1 review failed: ${(err as Error).message}`,
      };
    }
  }

  private parseOutput(text: string): ReviewResult {
    const data = extractJson(text);
    if (!data) {
      return {
        success: true,
        conclusion: {
          verdict: "pass",
          blockers: [],
          factual_risks: [],
          missing_evidence: [],
          scope_violations: [],
          suggested_revisions: [text.slice(0, 200)],
        },
      };
    }

    const blockers = Array.isArray(data.blockers)
      ? (data.blockers as string[]).filter((b) => typeof b === "string")
      : [];
    const verdict = blockers.length > 0 || data.verdict === "revise" ? "revise" : "pass";

    return {
      success: true,
      conclusion: {
        verdict,
        blockers,
        factual_risks: Array.isArray(data.factual_risks) ? (data.factual_risks as string[]) : [],
        missing_evidence: Array.isArray(data.missing_evidence) ? (data.missing_evidence as string[]) : [],
        scope_violations: Array.isArray(data.scope_violations) ? (data.scope_violations as string[]) : [],
        suggested_revisions: Array.isArray(data.suggested_revisions) ? (data.suggested_revisions as string[]) : [],
      },
    };
  }
}
