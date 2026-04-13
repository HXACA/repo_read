import type { LanguageModel, ToolSet } from "ai";
import type { StepInfo } from "../agent/agent-loop.js";
import type {
  ReviewBriefing,
  ReviewConclusion,
  VerifiedCitation,
} from "../types/review.js";
import {
  buildReviewerSystemPrompt,
  buildReviewerUserPrompt,
  type ReviewerStrictness,
} from "./reviewer-prompt.js";
import { createCatalogTools } from "../catalog/catalog-tools.js";
import { extractJson } from "../utils/extract-json.js";
import { PromptAssembler } from "../prompt/assembler.js";
import { TurnEngineAdapter } from "../runtime/turn-engine.js";

export type ReviewResult = {
  success: boolean;
  conclusion?: ReviewConclusion;
  error?: string;
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
  onStep?: (step: StepInfo) => void;
};

export class FreshReviewer {
  private readonly model: LanguageModel;
  private readonly repoRoot: string;
  private readonly maxSteps: number;
  private readonly verifyMinCitations: number;
  private readonly strictness: ReviewerStrictness;
  private readonly allowBash: boolean;
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
          retry: { maxRetries: 0, baseDelayMs: 0, backoffFactor: 1 },
          overflow: { strategy: "none" },
          toolBatch: { strategy: "sequential" },
        },
        onStep: this.onStep,
      });

      return this.parseOutput(result.text);
    } catch (err) {
      return {
        success: false,
        error: `Review failed: ${(err as Error).message}`,
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
    // mentioned. Keeps the review gate honest even if the LLM forgets rule 7.
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

    // If any non-match verifications, the verdict must be "revise"
    const hasVerificationFailure = verified.some((v) => v.status !== "match");
    const rawVerdict =
      data.verdict === "revise" ? "revise" : ("pass" as const);
    const verdict =
      hasVerificationFailure || blockers.length > 0 ? "revise" : rawVerdict;

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
        suggested_revisions: Array.isArray(data.suggested_revisions)
          ? (data.suggested_revisions as string[])
          : [],
        ...(verified.length > 0 ? { verified_citations: verified } : {}),
      },
    };
  }
}
