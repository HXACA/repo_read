import type { QualityProfile } from "../config/quality-profile.js";
import type { PageComplexityScore } from "./complexity-scorer.js";

export type RuntimeSignals = {
  lowCitationDensity?: boolean;
  draftTruncated?: boolean;
  factualRisksCount?: number;
  missingEvidenceCount?: number;
};

export type AdjustedParams = QualityProfile & {
  maxOutputTokensBoost: number;
};

export function adjustParams(
  base: QualityProfile,
  complexity: PageComplexityScore,
  signals: RuntimeSignals = {},
): AdjustedParams {
  let forkWorkers = base.forkWorkers;
  let drafterMaxSteps = base.drafterMaxSteps;
  let reviewerVerifyMinCitations = base.reviewerVerifyMinCitations;
  let maxOutputTokensBoost = 0;

  // Complexity-based adjustments (only increase)
  if (complexity.score > 15) {
    forkWorkers += 2;
    drafterMaxSteps += 10;
  } else if (complexity.score > 8) {
    forkWorkers += 1;
    drafterMaxSteps += 5;
  }

  // Runtime signal adjustments
  if (signals.lowCitationDensity) {
    reviewerVerifyMinCitations += 2;
  }
  if (signals.draftTruncated) {
    maxOutputTokensBoost = 4096;
  }
  if ((signals.factualRisksCount ?? 0) > 0) {
    forkWorkers += 1;
  }
  if ((signals.missingEvidenceCount ?? 0) > 0) {
    forkWorkers += 1;
  }

  return {
    ...base,
    forkWorkers,
    drafterMaxSteps,
    reviewerVerifyMinCitations,
    maxOutputTokensBoost,
  };
}
