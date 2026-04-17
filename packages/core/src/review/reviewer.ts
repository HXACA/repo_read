import type { LanguageModel, ToolSet } from "ai";
import type { StepInfo } from "../agent/agent-loop.js";
import type {
  ReviewBriefing,
  ReviewConclusion,
  VerifiedCitation,
} from "../types/review.js";
import type { UsageInput } from "../utils/usage-tracker.js";
import {
  buildReviewerSystemPrompt,
  buildReviewerUserPrompt,
  type ReviewerStrictness,
} from "./reviewer-prompt.js";
import { createCatalogTools } from "../catalog/catalog-tools.js";
import { extractJson } from "../utils/extract-json.js";
import { PromptAssembler } from "../prompt/assembler.js";
import { TurnEngineAdapter } from "../runtime/turn-engine.js";
import type { ProviderCallOptions } from "../runtime/turn-types.js";

export type ReviewResult = {
  success: boolean;
  conclusion?: ReviewConclusion;
  error?: string;
  metrics?: { llmCalls: number; usage: UsageInput };
};

export type FreshReviewerOptions = {
  model: LanguageModel;
  repoRoot: string;
  /** Upper bound on tool-call steps within a single review run. Defaults to 10. */
  maxSteps?: number;
  /**
   * Number of citations the reviewer MUST verify with the `read` tool.
   * 0 disables the verification requirement (budget mode).
   */
  verifyMinCitations?: number;
  /**
   * Controls the reviewer's verdict threshold:
   * - `strict` rejects on any factual risk
   * - `normal` (default) only gates on blockers
   * - `lenient` only gates on hard blockers that actively mislead
   */
  strictness?: ReviewerStrictness;
  allowBash?: boolean;
  providerCallOptions?: ProviderCallOptions;
  onStep?: (step: StepInfo) => void;
};

export class FreshReviewer {
  private readonly model: LanguageModel;
  private readonly repoRoot: string;
  private readonly maxSteps: number;
  private readonly verifyMinCitations: number;
  private readonly strictness: ReviewerStrictness;
  private readonly allowBash: boolean;
  private readonly providerCallOptions?: ProviderCallOptions;
  private readonly onStep?: (step: StepInfo) => void;
  private readonly promptAssembler: PromptAssembler;
  private readonly turnEngine: TurnEngineAdapter;

  constructor(options: FreshReviewerOptions) {
    this.model = options.model;
    this.repoRoot = options.repoRoot;
    this.maxSteps = options.maxSteps ?? 10;
    this.verifyMinCitations = options.verifyMinCitations ?? 0;
    this.strictness = options.strictness ?? "normal";
    this.allowBash = options.allowBash ?? true;
    this.providerCallOptions = options.providerCallOptions;
    this.onStep = options.onStep;
    this.promptAssembler = new PromptAssembler();
    this.turnEngine = new TurnEngineAdapter();
  }

  async review(briefing: ReviewBriefing): Promise<ReviewResult> {
    const systemPrompt = buildReviewerSystemPrompt(
      this.verifyMinCitations,
      this.strictness,
    );
    const userPrompt = buildReviewerUserPrompt(briefing);
    const tools = createCatalogTools(this.repoRoot, { allowBash: this.allowBash });

    try {
      const assembled = this.promptAssembler.assemble({ role: "reviewer", language: "en", systemPrompt, userPrompt });
      const result = await this.turnEngine.run({
        purpose: "review",
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

      const parsed = this.parseOutput(result.text);
      return {
        ...parsed,
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
        error: `Review failed: ${(err as Error).message}`,
      };
    }
  }

  private parseOutput(text: string): ReviewResult {
    return parseFreshReviewerOutput(text);
  }
}

/**
 * Parses a FreshReviewer LLM output string into a ReviewResult. Exported for
 * unit testing. Defensively coerces every field so malformed JSON never
 * throws — the pipeline can rely on shape even if the model hallucinates.
 *
 * Promotes `missing_coverage` entries into blockers with a `[coverage:<id>]`
 * marker, and forces `verdict = "revise"` when any coverage gap is reported.
 */
export function parseFreshReviewerOutput(text: string): ReviewResult {
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
        missing_coverage: [],
        suggested_revisions: [text.slice(0, 200)],
      },
    };
  }

  const blockers = Array.isArray(data.blockers)
    ? (data.blockers as unknown[]).filter((b): b is string => typeof b === "string")
    : [];

  const missingCoverage = Array.isArray(data.missing_coverage)
    ? (data.missing_coverage as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  // Promote any missing_coverage entries into blockers (visible to pipeline + revision prompt).
  for (const id of missingCoverage) {
    const marker = `[coverage:${id}]`;
    if (!blockers.some((b) => b.includes(marker))) {
      blockers.push(`Mechanism ${marker} not covered in draft`);
    }
  }

  // Parse verified_citations, defensively coerce each entry
  const verified: VerifiedCitation[] = [];
  if (Array.isArray(data.verified_citations)) {
    for (const rawEntry of data.verified_citations as unknown[]) {
      if (!rawEntry || typeof rawEntry !== "object") continue;
      const e = rawEntry as Record<string, unknown>;
      const rawCitation =
        e.citation && typeof e.citation === "object"
          ? (e.citation as Record<string, unknown>)
          : null;
      if (!rawCitation) continue;
      const kindRaw = rawCitation.kind;
      const kind: "file" | "page" | "commit" =
        kindRaw === "page" || kindRaw === "commit" ? kindRaw : "file";
      const target =
        typeof rawCitation.target === "string" ? rawCitation.target : "";
      if (!target) continue;
      const locator =
        typeof rawCitation.locator === "string" ? rawCitation.locator : undefined;

      const statusRaw = e.status;
      const status: VerifiedCitation["status"] =
        statusRaw === "mismatch" || statusRaw === "not_found"
          ? statusRaw
          : "match";
      const note = typeof e.note === "string" ? e.note : undefined;

      verified.push({ citation: { kind, target, locator }, status, note });
    }
  }

  // Defensive: promote any mismatch/not_found to blockers if not already
  // mentioned. Keeps the review gate honest even if the LLM forgets the rule.
  for (const v of verified) {
    if (v.status === "match") continue;
    const locator = v.citation.locator ? `:${v.citation.locator}` : "";
    const marker = `[${v.citation.kind}:${v.citation.target}${locator}]`;
    const alreadyMentioned = blockers.some((b) => b.includes(marker));
    if (!alreadyMentioned) {
      const prefix =
        v.status === "not_found"
          ? `Citation ${marker} not found in the repository`
          : `Citation ${marker} does not match the draft's claim`;
      blockers.push(v.note ? `${prefix}: ${v.note}` : prefix);
    }
  }

  // If any non-match verifications OR any missing coverage, the verdict must be "revise"
  const hasVerificationFailure = verified.some((v) => v.status !== "match");
  const rawVerdict =
    data.verdict === "revise" ? "revise" : ("pass" as const);
  const verdict =
    blockers.length > 0 || hasVerificationFailure || missingCoverage.length > 0
      ? "revise"
      : rawVerdict;

  return {
    success: true,
    conclusion: {
      verdict,
      blockers,
      factual_risks: Array.isArray(data.factual_risks)
        ? (data.factual_risks as string[])
        : [],
      missing_evidence: Array.isArray(data.missing_evidence)
        ? (data.missing_evidence as string[])
        : [],
      scope_violations: Array.isArray(data.scope_violations)
        ? (data.scope_violations as string[])
        : [],
      missing_coverage: missingCoverage,
      suggested_revisions: Array.isArray(data.suggested_revisions)
        ? (data.suggested_revisions as string[])
        : [],
      ...(verified.length > 0 ? { verified_citations: verified } : {}),
    },
  };
}
