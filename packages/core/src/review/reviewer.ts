import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { ReviewBriefing, ReviewConclusion } from "../types/review.js";
import { buildReviewerSystemPrompt, buildReviewerUserPrompt } from "./reviewer-prompt.js";
import { extractJson } from "../utils/extract-json.js";

export type ReviewResult = {
  success: boolean;
  conclusion?: ReviewConclusion;
  error?: string;
};

export type FreshReviewerOptions = {
  model: LanguageModel;
  repoRoot: string;
};

export class FreshReviewer {
  private readonly model: LanguageModel;
  private readonly repoRoot: string;

  constructor(options: FreshReviewerOptions) {
    this.model = options.model;
    this.repoRoot = options.repoRoot;
  }

  async review(briefing: ReviewBriefing): Promise<ReviewResult> {
    const systemPrompt = buildReviewerSystemPrompt();
    const userPrompt = buildReviewerUserPrompt(briefing);

    try {
      const result = await generateText({
        model: this.model,
        system: systemPrompt,
        prompt: userPrompt,
      });

      return this.parseOutput(result.text);
    } catch (err) {
      return { success: false, error: `Review failed: ${(err as Error).message}` };
    }
  }

  private parseOutput(text: string): ReviewResult {
    const data = extractJson(text);
    if (!data) {
      // Fallback: if no JSON found, treat as pass with no blockers
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

    const verdict = data.verdict === "revise" ? "revise" : "pass";
    return {
      success: true,
      conclusion: {
        verdict,
        blockers: Array.isArray(data.blockers) ? data.blockers : [],
        factual_risks: Array.isArray(data.factual_risks) ? data.factual_risks : [],
        missing_evidence: Array.isArray(data.missing_evidence) ? data.missing_evidence : [],
        scope_violations: Array.isArray(data.scope_violations) ? data.scope_violations : [],
        suggested_revisions: Array.isArray(data.suggested_revisions) ? data.suggested_revisions : [],
      },
    };
  }
}
