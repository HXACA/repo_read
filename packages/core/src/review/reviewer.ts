import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { ReviewBriefing, ReviewConclusion } from "../types/review.js";
import { buildReviewerSystemPrompt, buildReviewerUserPrompt } from "./reviewer-prompt.js";

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
    let jsonStr = text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    try {
      const data = JSON.parse(jsonStr);
      if (!data.verdict || !["pass", "revise"].includes(data.verdict)) {
        return { success: false, error: "Invalid review: missing or invalid verdict" };
      }
      return {
        success: true,
        conclusion: {
          verdict: data.verdict,
          blockers: data.blockers ?? [],
          factual_risks: data.factual_risks ?? [],
          missing_evidence: data.missing_evidence ?? [],
          scope_violations: data.scope_violations ?? [],
          suggested_revisions: data.suggested_revisions ?? [],
        },
      };
    } catch {
      return { success: false, error: "Failed to parse review output as JSON" };
    }
  }
}
