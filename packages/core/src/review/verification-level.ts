import type { ExecutionLane } from "../generation/throughput-metrics.js";
import type { RuntimeSignals } from "../generation/param-adjuster.js";

export type VerificationLevel = "L0" | "L1" | "L2";

export type VerificationLevelInput = {
  lane: ExecutionLane;
  complexityScore: number;
  signals: RuntimeSignals;
  revisionAttempt: number;
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
  const { lane, complexityScore, signals, revisionAttempt } = input;

  // L2 upgrade conditions — any one triggers expensive review
  const needsL2 =
    lane === "deep" ||
    complexityScore >= 12 ||
    (signals.factualRisksCount ?? 0) > 0 ||
    (signals.missingEvidenceCount ?? 0) > 0 ||
    signals.draftTruncated === true ||
    revisionAttempt > 1 ||
    signals.lowCitationDensity === true;

  if (needsL2) return "L2";

  // Fast lane with low complexity → deterministic only
  if (lane === "fast" && complexityScore <= 4) return "L0";

  // Everything else → cheap semantic
  return "L1";
}
