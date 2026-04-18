import type { ExecutionLane } from "../generation/throughput-metrics.js";
import type { RuntimeSignals } from "../generation/param-adjuster.js";

export type VerificationLevel = "L0" | "L1" | "L2";

export type VerificationLevelInput = {
  lane: ExecutionLane;
  complexityScore: number;
  signals: RuntimeSignals;
  revisionAttempt: number;
  /**
   * Total revision budget for this page. When `revisionAttempt >=
   * maxRevisionAttempts` the pipeline cannot act on a revise verdict, so we
   * suppress the "escalate to L2 purely because we're on attempt 2+" rule.
   * Genuine quality signals (factual risks, missing evidence, truncation,
   * lowCitationDensity, deep lane, high complexity) still force L2.
   * Optional for backward compatibility with callers that don't track it.
   */
  maxRevisionAttempts?: number;
};

/**
 * Determine how deep to verify a page.
 *
 * - **L0**: Deterministic checks only (structure, citations, links, mermaid).
 * - **L1**: L0 + cheap semantic LLM review (no tool calls).
 * - **L2**: L0 + L1 + expensive factual review with tool-based citation verification.
 *
 * L2 upgrade conditions are checked first — any single trigger forces L2
 * regardless of lane. Then lane determines the baseline level.
 */
export function selectVerificationLevel(input: VerificationLevelInput): VerificationLevel {
  const { lane, complexityScore, signals, revisionAttempt, maxRevisionAttempts } = input;

  // Suppress the "revisionAttempt > 1" escalation on the terminal attempt —
  // the pipeline cannot revise further based on L2's verdict, so paying for
  // tool-backed verification only to label the page degraded is wasted cost.
  const revisionBasedEscalation =
    revisionAttempt > 1 &&
    (maxRevisionAttempts === undefined || revisionAttempt < maxRevisionAttempts);

  // L2 upgrade conditions — any one triggers expensive review
  const needsL2 =
    lane === "deep" ||
    complexityScore >= 12 ||
    (signals.factualRisksCount ?? 0) > 0 ||
    (signals.missingEvidenceCount ?? 0) > 0 ||
    signals.draftTruncated === true ||
    revisionBasedEscalation ||
    signals.lowCitationDensity === true;

  if (needsL2) return "L2";

  // Fast lane with low complexity → deterministic only
  if (lane === "fast" && complexityScore <= 4) return "L0";

  // Everything else → cheap semantic
  return "L1";
}
