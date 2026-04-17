import type { LanguageModel } from "ai";
import type { StepInfo } from "../agent/agent-loop.js";
import type { ReviewBriefing, ReviewConclusion } from "../types/review.js";
import type { UsageInput } from "../utils/usage-tracker.js";
import type { ReviewerStrictness } from "./reviewer-prompt.js";
import type { ProviderCallOptions } from "../runtime/turn-types.js";
import type { PageValidationInput } from "../validation/page-validator.js";
import type { VerificationLevel } from "./verification-level.js";
import { validatePage } from "../validation/page-validator.js";
import { L1SemanticReviewer } from "./l1-semantic-reviewer.js";
import { FreshReviewer } from "./reviewer.js";
import type { ReviewResult } from "./reviewer.js";

export type VerificationLadderOptions = {
  reviewerModel: LanguageModel;
  repoRoot: string;
  l2MaxSteps?: number;
  l2VerifyMinCitations?: number;
  strictness?: ReviewerStrictness;
  allowBash?: boolean;
  providerCallOptions?: ProviderCallOptions;
  onStep?: (step: StepInfo) => void;
};

export type LadderVerifyInput = {
  level: VerificationLevel;
  briefing: ReviewBriefing;
  draftContent: string;
  validationInput: PageValidationInput;
};

export type LadderResult = ReviewResult & {
  /** The deepest level actually executed. May be less than requested if an earlier level returned revise. */
  levelReached: VerificationLevel;
};

/** Deduplicate string arrays while preserving order. */
function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

export class VerificationLadder {
  private readonly l1: L1SemanticReviewer;
  private readonly l2: FreshReviewer;

  constructor(options: VerificationLadderOptions) {
    this.l1 = new L1SemanticReviewer({
      model: options.reviewerModel,
      strictness: options.strictness,
      providerCallOptions: options.providerCallOptions,
      onStep: options.onStep,
    });
    this.l2 = new FreshReviewer({
      model: options.reviewerModel,
      repoRoot: options.repoRoot,
      maxSteps: options.l2MaxSteps ?? 10,
      verifyMinCitations: options.l2VerifyMinCitations ?? 0,
      strictness: options.strictness,
      allowBash: options.allowBash ?? true,
      providerCallOptions: options.providerCallOptions,
      onStep: options.onStep,
    });
  }

  async verify(input: LadderVerifyInput): Promise<LadderResult> {
    const { level, briefing, draftContent, validationInput } = input;

    const totalMetrics: { llmCalls: number; usage: UsageInput } = {
      llmCalls: 0,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedTokens: 0,
      },
    };

    // --- L0: Deterministic validation (always runs) ---
    const l0Result = validatePage(validationInput);
    const l0Blockers = l0Result.errors.map((e) => `[L0] ${e}`);

    if (level === "L0") {
      const verdict = l0Blockers.length > 0 ? "revise" : "pass";
      return {
        success: true,
        conclusion: {
          verdict,
          blockers: l0Blockers,
          factual_risks: [],
          missing_evidence: [],
          scope_violations: [],
          suggested_revisions: l0Result.warnings.map((w) => `[L0] ${w}`),
        },
        metrics: totalMetrics,
        levelReached: "L0",
      };
    }

    // --- L1: Cheap semantic review ---
    const l1Result = await this.l1.review(briefing, draftContent);
    if (l1Result.metrics) {
      totalMetrics.llmCalls += l1Result.metrics.llmCalls;
      totalMetrics.usage.inputTokens += l1Result.metrics.usage.inputTokens;
      totalMetrics.usage.outputTokens += l1Result.metrics.usage.outputTokens;
      totalMetrics.usage.reasoningTokens +=
        l1Result.metrics.usage.reasoningTokens;
      totalMetrics.usage.cachedTokens += l1Result.metrics.usage.cachedTokens;
    }

    // L1 failure handling:
    // - level=L1: propagate failure so pipeline's unverified-pass degradation kicks in
    // - level=L2: continue to L2 (authoritative reviewer) regardless of L1 outcome
    if (!l1Result.success && level === "L1") {
      return {
        success: false,
        error: l1Result.error ?? "L1 semantic review failed",
        metrics: totalMetrics,
        levelReached: "L1",
      };
    }

    const l1Conclusion: ReviewConclusion = l1Result.conclusion ?? {
      verdict: "pass" as const,
      blockers: [],
      factual_risks: [],
      missing_evidence: [],
      scope_violations: [],
      suggested_revisions: [],
    };
    const mergedBlockers = [...l0Blockers, ...l1Conclusion.blockers];
    const mergedVerdict =
      mergedBlockers.length > 0 ? "revise" : l1Conclusion.verdict;

    if (level === "L1" || mergedVerdict === "revise") {
      return {
        success: true,
        conclusion: {
          ...l1Conclusion,
          verdict: mergedVerdict,
          blockers: mergedBlockers,
          suggested_revisions: [
            ...l0Result.warnings.map((w) => `[L0] ${w}`),
            ...l1Conclusion.suggested_revisions,
          ],
        },
        metrics: totalMetrics,
        levelReached: "L1",
      };
    }

    // --- L2: Expensive factual review ---
    const l2Result = await this.l2.review(briefing);
    if (l2Result.metrics) {
      totalMetrics.llmCalls += l2Result.metrics.llmCalls;
      totalMetrics.usage.inputTokens += l2Result.metrics.usage.inputTokens;
      totalMetrics.usage.outputTokens += l2Result.metrics.usage.outputTokens;
      totalMetrics.usage.reasoningTokens +=
        l2Result.metrics.usage.reasoningTokens;
      totalMetrics.usage.cachedTokens += l2Result.metrics.usage.cachedTokens;
    }

    const l2Conclusion: ReviewConclusion = l2Result.conclusion ?? l1Conclusion;

    // Merge L1 non-blocker findings into L2 conclusion so they don't disappear.
    // L2 is authoritative for verdict/blockers, but L1 may have caught semantic
    // issues (low citation density, scope drift hints) that L2 didn't repeat.
    const mergedFactualRisks = dedup([
      ...l1Conclusion.factual_risks,
      ...l2Conclusion.factual_risks,
    ]);
    const mergedMissingEvidence = dedup([
      ...l1Conclusion.missing_evidence,
      ...l2Conclusion.missing_evidence,
    ]);
    const mergedScopeViolations = dedup([
      ...l1Conclusion.scope_violations,
      ...l2Conclusion.scope_violations,
    ]);
    const mergedMissingCoverage = dedup([
      ...(l1Conclusion.missing_coverage ?? []),
      ...(l2Conclusion.missing_coverage ?? []),
    ]);

    const finalBlockers = [...l0Blockers, ...l2Conclusion.blockers];
    const finalVerdict =
      finalBlockers.length > 0 ? "revise" : l2Conclusion.verdict;

    return {
      success: l2Result.success,
      conclusion: {
        ...l2Conclusion,
        verdict: finalVerdict,
        blockers: finalBlockers,
        factual_risks: mergedFactualRisks,
        missing_evidence: mergedMissingEvidence,
        scope_violations: mergedScopeViolations,
        missing_coverage: mergedMissingCoverage.length > 0 ? mergedMissingCoverage : undefined,
        suggested_revisions: dedup([
          ...l0Result.warnings.map((w) => `[L0] ${w}`),
          ...l1Conclusion.suggested_revisions,
          ...l2Conclusion.suggested_revisions,
        ]),
      },
      metrics: totalMetrics,
      levelReached: "L2",
    };
  }
}
