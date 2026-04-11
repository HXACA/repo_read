import type { Preset } from "../types/config.js";

/**
 * Runtime quality profile derived from a {@link Preset}. It drives the
 * agent orchestration strategy across the whole page pipeline:
 *
 * - `forkWorkers` — how many parallel `fork.worker` evidence-collection tasks
 *   the {@link EvidenceCoordinator} spawns per page. `0` disables the
 *   coordinator entirely and the drafter falls back to its own tool calls.
 * - `forkWorkerConcurrency` — upper bound on in-flight worker executions.
 * - `maxRevisionAttempts` — how many times a page may be re-drafted after a
 *   reviewer returns `verdict: revise`. `0` means no retries.
 * - `drafterMaxSteps` — `stepCountIs(...)` budget for main.author drafter.
 * - `reviewerMaxSteps` — `stepCountIs(...)` budget for fresh.reviewer.
 * - `reviewerVerifyMinCitations` — number of citations the reviewer MUST
 *   verify with the `read` tool. `0` disables the verification requirement.
 * - `reviewerStrictness` — tone setting for the reviewer system prompt.
 * - `askMaxSteps` — `stepCountIs(...)` budget for AskStreamService (chat
 *   assistant). Covers page-first and page-plus-retrieval routes.
 * - `researchMaxSteps` — `stepCountIs(...)` budget for each research
 *   planner/executor LLM call (per sub-question in the executor).
 */
export type QualityProfile = {
  forkWorkers: number;
  forkWorkerConcurrency: number;
  maxRevisionAttempts: number;
  drafterMaxSteps: number;
  reviewerMaxSteps: number;
  reviewerVerifyMinCitations: number;
  reviewerStrictness: "lenient" | "normal" | "strict";
  catalogMaxSteps: number;
  askMaxSteps: number;
  researchMaxSteps: number;
};

/**
 * Canonical mapping from preset to runtime profile.
 *
 * Values were chosen to make the tradeoff visible:
 * `quality` favors correctness (3 workers, 3 retries, reviewer must verify),
 * `balanced` is the default sweet spot, `budget` minimizes LLM calls while
 * still running review/validate, and `local-only` mirrors budget with tighter
 * step budgets for small local models.
 */
export const QUALITY_PROFILES: Readonly<Record<Preset, Readonly<QualityProfile>>> = Object.freeze({
  quality: Object.freeze({
    forkWorkers: 3,
    forkWorkerConcurrency: 3,
    maxRevisionAttempts: 3,
    catalogMaxSteps: 40,
    drafterMaxSteps: 30,
    reviewerMaxSteps: 15,
    reviewerVerifyMinCitations: 3,
    reviewerStrictness: "strict",
    askMaxSteps: 15,
    researchMaxSteps: 20,
  }),
  balanced: Object.freeze({
    forkWorkers: 2,
    forkWorkerConcurrency: 2,
    maxRevisionAttempts: 2,
    catalogMaxSteps: 30,
    drafterMaxSteps: 20,
    reviewerMaxSteps: 10,
    reviewerVerifyMinCitations: 2,
    reviewerStrictness: "normal",
    askMaxSteps: 10,
    researchMaxSteps: 15,
  }),
  budget: Object.freeze({
    forkWorkers: 1,
    forkWorkerConcurrency: 1,
    maxRevisionAttempts: 1,
    catalogMaxSteps: 20,
    drafterMaxSteps: 12,
    reviewerMaxSteps: 6,
    reviewerVerifyMinCitations: 0,
    reviewerStrictness: "lenient",
    askMaxSteps: 4,
    researchMaxSteps: 8,
  }),
  "local-only": Object.freeze({
    forkWorkers: 1,
    forkWorkerConcurrency: 1,
    maxRevisionAttempts: 1,
    catalogMaxSteps: 20,
    drafterMaxSteps: 12,
    reviewerMaxSteps: 6,
    reviewerVerifyMinCitations: 0,
    reviewerStrictness: "normal",
    askMaxSteps: 4,
    researchMaxSteps: 8,
  }),
});

/**
 * Returns the runtime profile for a given preset. The returned object is
 * frozen; callers must not mutate it.
 */
export function getQualityProfile(preset: Preset): QualityProfile {
  return QUALITY_PROFILES[preset];
}
