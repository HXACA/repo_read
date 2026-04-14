# P7: Verification Ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic `FreshReviewer` into a 3-level verification system (L0 deterministic → L1 cheap semantic → L2 expensive factual) so cheap pages skip expensive review and review budget is concentrated on high-risk pages.

**Architecture:** A new `selectVerificationLevel()` function decides which levels to run based on lane, complexity, and runtime signals. L0 reuses the existing `validatePage()` deterministic validators. L1 is a new no-tool-call LLM review for semantic checks. L2 is the existing `FreshReviewer` with tool calls and citation verification, reserved for high-risk pages. The pipeline calls a new `VerificationLadder.verify()` method that orchestrates L0→L1→L2 in sequence, short-circuiting when the selected level is reached.

**Tech Stack:** TypeScript strict, Vitest, Vercel AI SDK v6

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/review/verification-level.ts` | Create | `VerificationLevel` type + `selectVerificationLevel()` pure function |
| `src/review/verification-level.test.ts` | Create | Tests for level selection logic |
| `src/review/l1-semantic-reviewer.ts` | Create | L1 cheap semantic reviewer (no tool calls) |
| `src/review/l1-semantic-prompt.ts` | Create | L1 prompt builder |
| `src/review/__tests__/l1-semantic-reviewer.test.ts` | Create | Tests for L1 reviewer |
| `src/review/verification-ladder.ts` | Create | Orchestrator: runs L0→L1→L2 in sequence |
| `src/review/__tests__/verification-ladder.test.ts` | Create | Tests for the ladder orchestrator |
| `src/review/index.ts` | Modify | Add new exports |
| `src/generation/throughput-metrics.ts` | Modify | Add `verificationLevel` field to `PageThroughputRecord` |
| `src/generation/generation-pipeline.ts` | Modify | Replace direct `FreshReviewer` call with `VerificationLadder` |
| `src/config/quality-profile.ts` | Modify | No changes needed — existing `reviewerVerifyMinCitations` and `reviewerStrictness` naturally map to L1 vs L2 |

---

### Task 1: Verification Level Types and Selection Logic

**Files:**
- Create: `packages/core/src/review/verification-level.ts`
- Create: `packages/core/src/review/__tests__/verification-level.test.ts`

This task defines the `VerificationLevel` type and the pure function `selectVerificationLevel()` that decides how deep to verify a page based on lane, complexity score, and runtime signals.

**Selection rules (from the spec):**
- L0 only: fast lane pages with complexity ≤ 4 (deterministic checks are enough)
- L1 (L0 + cheap semantic): standard lane, or fast lane pages with complexity > 4
- L2 (L0 + L1 + expensive factual): triggered by ANY of these upgrade conditions:
  1. deep lane
  2. complexity score ≥ 12
  3. factualRisksCount > 0 (from previous review)
  4. missingEvidenceCount > 0 (from previous review)
  5. draftTruncated === true
  6. revision attempt > 1
  7. lowCitationDensity === true

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/review/__tests__/verification-level.test.ts
import { describe, it, expect } from "vitest";
import { selectVerificationLevel } from "../verification-level.js";

describe("selectVerificationLevel", () => {
  it("returns L0 for fast lane with low complexity", () => {
    expect(
      selectVerificationLevel({
        lane: "fast",
        complexityScore: 3,
        signals: {},
        revisionAttempt: 0,
      }),
    ).toBe("L0");
  });

  it("returns L1 for standard lane with moderate complexity", () => {
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 8,
        signals: {},
        revisionAttempt: 0,
      }),
    ).toBe("L1");
  });

  it("returns L1 for fast lane with complexity > 4", () => {
    expect(
      selectVerificationLevel({
        lane: "fast",
        complexityScore: 5,
        signals: {},
        revisionAttempt: 0,
      }),
    ).toBe("L1");
  });

  it("returns L2 for deep lane", () => {
    expect(
      selectVerificationLevel({
        lane: "deep",
        complexityScore: 20,
        signals: {},
        revisionAttempt: 0,
      }),
    ).toBe("L2");
  });

  it("upgrades to L2 when complexity >= 12", () => {
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 12,
        signals: {},
        revisionAttempt: 0,
      }),
    ).toBe("L2");
  });

  it("upgrades to L2 when factualRisksCount > 0", () => {
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 5,
        signals: { factualRisksCount: 2 },
        revisionAttempt: 0,
      }),
    ).toBe("L2");
  });

  it("upgrades to L2 when missingEvidenceCount > 0", () => {
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 5,
        signals: { missingEvidenceCount: 1 },
        revisionAttempt: 0,
      }),
    ).toBe("L2");
  });

  it("upgrades to L2 when draftTruncated", () => {
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 5,
        signals: { draftTruncated: true },
        revisionAttempt: 0,
      }),
    ).toBe("L2");
  });

  it("upgrades to L2 when revision attempt > 1", () => {
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 5,
        signals: {},
        revisionAttempt: 2,
      }),
    ).toBe("L2");
  });

  it("upgrades to L2 when lowCitationDensity", () => {
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 5,
        signals: { lowCitationDensity: true },
        revisionAttempt: 0,
      }),
    ).toBe("L2");
  });

  it("L2 upgrade overrides L0 for fast lane with high-risk signals", () => {
    expect(
      selectVerificationLevel({
        lane: "fast",
        complexityScore: 3,
        signals: { factualRisksCount: 1 },
        revisionAttempt: 0,
      }),
    ).toBe("L2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run packages/core/src/review/__tests__/verification-level.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/review/verification-level.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run packages/core/src/review/__tests__/verification-level.test.ts`
Expected: ALL PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/review/verification-level.ts packages/core/src/review/__tests__/verification-level.test.ts
git commit -m "feat(review): add verification level selection logic for P7 ladder"
```

---

### Task 2: L1 Semantic Reviewer (No Tool Calls)

**Files:**
- Create: `packages/core/src/review/l1-semantic-prompt.ts`
- Create: `packages/core/src/review/l1-semantic-reviewer.ts`
- Create: `packages/core/src/review/__tests__/l1-semantic-reviewer.test.ts`

The L1 reviewer is a lightweight LLM call that checks:
- Obvious scope drift (does the draft match the page plan?)
- Citation density (are there sections without citations?)
- Unsupported claim risk (are there bold claims with no evidence?)

It does NOT use tools — no `read`, no `grep`, no `bash`. This makes it fast and cheap.

It returns the same `ReviewResult` type as `FreshReviewer` for compatibility, but `verifyMinCitations` is always 0 and `maxSteps` is always 1 (no tool loops).

- [ ] **Step 1: Write the L1 prompt builder**

```typescript
// packages/core/src/review/l1-semantic-prompt.ts
import type { ReviewBriefing } from "../types/review.js";
import type { ReviewerStrictness } from "./reviewer-prompt.js";

/**
 * Strictness-specific verdict threshold for L1 semantic review.
 * Same concept as the L2 reviewer, but calibrated for no-tool-call reviews.
 */
function l1StrictnessRule(strictness: ReviewerStrictness): string {
  switch (strictness) {
    case "strict":
      return `5. Return "pass" ONLY if you see zero scope violations and every section has citations. Any unsupported claim forces "revise".`;
    case "lenient":
      return `5. Return "pass" unless there are clear scope violations or entire sections without any evidence. Minor gaps are acceptable.`;
    case "normal":
    default:
      return `5. Return "pass" if there are no blockers. Flag factual risks and missing evidence as notes, not blockers, unless they are severe.`;
  }
}

export function buildL1SystemPrompt(strictness: ReviewerStrictness = "normal"): string {
  return `You are a lightweight semantic reviewer for a code-reading wiki page.

You perform a QUICK semantic review — no file reading, no tool calls. You evaluate
the draft based ONLY on the text provided to you.

Rules:
1. You have NO access to the repository. Do NOT hallucinate file contents.
2. Check if the draft stays within the scope described in the page plan.
3. Check if each ## section has at least one [cite:...] marker. Flag sections with zero citations.
4. Flag any bold claim (performance numbers, exact behavior, specific limitations) that has no citation.
${l1StrictnessRule(strictness)}
6. Return your conclusion as a single JSON object:

{
  "verdict": "pass" or "revise",
  "blockers": ["issues that prevent publication"],
  "factual_risks": ["claims not backed by evidence"],
  "missing_evidence": ["sections or topics lacking citations"],
  "scope_violations": ["content outside the page plan"],
  "suggested_revisions": ["specific actionable changes"]
}

Be concise. You are a fast gate, not an exhaustive reviewer.`;
}

export function buildL1UserPrompt(briefing: ReviewBriefing, draftContent: string): string {
  const sections: string[] = [];

  sections.push(`## Page Title: ${briefing.page_title}`);
  sections.push(`## Section Position: ${briefing.section_position}`);
  sections.push(`## Page Plan\n${briefing.current_page_plan}`);
  sections.push(`## Covered Files\n${briefing.covered_files.join("\n")}`);

  if (briefing.previous_review) {
    const prev = briefing.previous_review;
    sections.push(`## Previous Review Issues`);
    if (prev.blockers.length > 0) {
      sections.push(`**Blockers:**\n${prev.blockers.map((b) => `- ${b}`).join("\n")}`);
    }
    if (prev.factual_risks.length > 0) {
      sections.push(`**Factual risks:**\n${prev.factual_risks.map((r) => `- ${r}`).join("\n")}`);
    }
  }

  sections.push(`## Draft Content\n\n${draftContent}`);
  sections.push(`\nReview the draft for scope compliance, citation density, and unsupported claims. Return your conclusion as JSON.`);

  return sections.join("\n\n");
}
```

- [ ] **Step 2: Write the L1 reviewer**

```typescript
// packages/core/src/review/l1-semantic-reviewer.ts
import type { LanguageModel } from "ai";
import type { StepInfo } from "../agent/agent-loop.js";
import type { ReviewBriefing } from "../types/review.js";
import type { UsageInput } from "../utils/usage-tracker.js";
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

/**
 * Lightweight semantic reviewer that checks scope, citation density, and
 * unsupported claims WITHOUT tool calls. Runs as a single LLM turn.
 */
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

  /**
   * Run a lightweight semantic review. The draft content is passed inline
   * (not read from disk via tools), making this a single LLM turn with no
   * tool calls.
   */
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
```

- [ ] **Step 3: Write the L1 tests**

```typescript
// packages/core/src/review/__tests__/l1-semantic-reviewer.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { L1SemanticReviewer } from "../l1-semantic-reviewer.js";
import type { ReviewBriefing } from "../../types/review.js";

vi.mock("ai", () => {
  const generateText = vi.fn();
  return {
    generateText,
    streamText: vi.fn((...args: unknown[]) => {
      const p = generateText(...args);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const safe = (fn: (r: any) => any) => { const q = p.then(fn); q.catch(() => {}); return q; };
      return {
        text: safe((r) => r?.text ?? ""),
        finishReason: safe((r) => r?.finishReason ?? "stop"),
        usage: safe((r) => r?.usage ?? {}),
        toolCalls: safe((r) => r?.toolCalls ?? []),
        toolResults: safe((r) => r?.toolResults ?? []),
        steps: safe((r) => r?.steps ?? []),
        response: safe((r) => r?.response ?? {}),
        fullStream: (async function* () { const r = await p; if (r?.text) yield { type: "text-delta", textDelta: r.text }; })(),
      };
    }),
    jsonSchema: vi.fn((s: unknown) => s),
    stepCountIs: vi.fn(() => () => false),
  };
});

const briefing: ReviewBriefing = {
  page_title: "Core Engine",
  section_position: "Page 2 of 5",
  current_page_plan: "Explain the core engine architecture and pipeline flow",
  full_book_summary: "A wiki covering setup, core engine, CLI, and web UI",
  draft_file: "/tmp/repo/.reporead/drafts/core-engine.md",
  covered_files: ["src/engine.ts", "src/pipeline.ts"],
  review_questions: ["Does the page stay within scope?"],
};

describe("L1SemanticReviewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns pass verdict for clean draft", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: "pass",
        blockers: [],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        suggested_revisions: [],
      }),
      usage: { inputTokens: 300, outputTokens: 80 },
    } as never);

    const reviewer = new L1SemanticReviewer({ model: {} as never });
    const result = await reviewer.review(briefing, "# Core Engine\n\nSome content with [cite:file:src/engine.ts:1-10].");

    expect(result.success).toBe(true);
    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.metrics!.llmCalls).toBe(1);
  });

  it("returns revise when blockers present", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: "revise",
        blockers: ["Section '## Data Flow' has no citations"],
        factual_risks: [],
        missing_evidence: ["Data Flow section needs file references"],
        scope_violations: [],
        suggested_revisions: ["Add citations to Data Flow section"],
      }),
      usage: { inputTokens: 300, outputTokens: 100 },
    } as never);

    const reviewer = new L1SemanticReviewer({ model: {} as never });
    const result = await reviewer.review(briefing, "# Core Engine\n\n## Data Flow\nNo citations here.");

    expect(result.success).toBe(true);
    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.blockers).toHaveLength(1);
  });

  it("promotes blockers to revise even if model says pass", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: "pass",
        blockers: ["Scope violation: discusses deployment"],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        suggested_revisions: [],
      }),
      usage: { inputTokens: 300, outputTokens: 80 },
    } as never);

    const reviewer = new L1SemanticReviewer({ model: {} as never });
    const result = await reviewer.review(briefing, "# Core Engine\n\nContent about deployment...");

    expect(result.conclusion!.verdict).toBe("revise");
  });

  it("passes tools={} with maxSteps=1 (no tool calls)", async () => {
    const { generateText } = await import("ai");
    const spy = vi.mocked(generateText);
    spy.mockResolvedValueOnce({
      text: JSON.stringify({ verdict: "pass", blockers: [], factual_risks: [], missing_evidence: [], scope_violations: [], suggested_revisions: [] }),
      usage: { inputTokens: 200, outputTokens: 50 },
    } as never);

    const reviewer = new L1SemanticReviewer({ model: {} as never });
    await reviewer.review(briefing, "# Content");

    // Verify no tools were passed
    const call = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(call.tools).toEqual({});
  });

  it("handles LLM failure gracefully", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockRejectedValueOnce(new Error("API error"));

    const reviewer = new L1SemanticReviewer({ model: {} as never });
    const result = await reviewer.review(briefing, "# Content");

    expect(result.success).toBe(false);
    expect(result.error).toContain("L1 review failed");
  });

  it("handles unparseable output as pass", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Looks good to me!",
      usage: { inputTokens: 200, outputTokens: 30 },
    } as never);

    const reviewer = new L1SemanticReviewer({ model: {} as never });
    const result = await reviewer.review(briefing, "# Content");

    expect(result.success).toBe(true);
    expect(result.conclusion!.verdict).toBe("pass");
  });

  it("strictness=strict changes system prompt", async () => {
    const { generateText } = await import("ai");
    const spy = vi.mocked(generateText);
    spy.mockResolvedValueOnce({
      text: JSON.stringify({ verdict: "pass", blockers: [], factual_risks: [], missing_evidence: [], scope_violations: [], suggested_revisions: [] }),
      usage: { inputTokens: 200, outputTokens: 50 },
    } as never);

    const reviewer = new L1SemanticReviewer({ model: {} as never, strictness: "strict" });
    await reviewer.review(briefing, "# Content");

    const call = spy.mock.calls[0][0] as { system?: string };
    expect(call.system).toContain("zero scope violations");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run packages/core/src/review/__tests__/l1-semantic-reviewer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: Create the files and run tests**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run packages/core/src/review/__tests__/l1-semantic-reviewer.test.ts`
Expected: ALL PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/review/l1-semantic-prompt.ts packages/core/src/review/l1-semantic-reviewer.ts packages/core/src/review/__tests__/l1-semantic-reviewer.test.ts
git commit -m "feat(review): add L1 semantic reviewer — no tool calls, cheap scope/density check"
```

---

### Task 3: Verification Ladder Orchestrator

**Files:**
- Create: `packages/core/src/review/verification-ladder.ts`
- Create: `packages/core/src/review/__tests__/verification-ladder.test.ts`
- Modify: `packages/core/src/review/index.ts`

The `VerificationLadder` is the single entry point the pipeline calls. It:
1. Always runs L0 (deterministic `validatePage()`)
2. If L0 has errors and level > L0 → still continues to L1/L2 (deterministic errors become blockers)
3. If selected level ≥ L1 → runs L1SemanticReviewer
4. If selected level = L2 → runs FreshReviewer (existing)
5. Merges results from all levels into a single `ReviewResult`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/review/__tests__/verification-ladder.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VerificationLadder } from "../verification-ladder.js";
import type { ReviewBriefing } from "../../types/review.js";
import type { ValidationReport } from "../../types/validation.js";
import type { ReviewResult } from "../reviewer.js";

// Mock FreshReviewer and L1SemanticReviewer
const mockL1Review = vi.fn<() => Promise<ReviewResult>>();
const mockL2Review = vi.fn<() => Promise<ReviewResult>>();
const mockValidatePage = vi.fn<() => ValidationReport>();

vi.mock("../l1-semantic-reviewer.js", () => ({
  L1SemanticReviewer: vi.fn().mockImplementation(() => ({
    review: mockL1Review,
  })),
}));

vi.mock("../reviewer.js", () => ({
  FreshReviewer: vi.fn().mockImplementation(() => ({
    review: mockL2Review,
  })),
}));

vi.mock("../../validation/page-validator.js", () => ({
  validatePage: (...args: unknown[]) => mockValidatePage(...args),
}));

const briefing: ReviewBriefing = {
  page_title: "Test Page",
  section_position: "Page 1 of 3",
  current_page_plan: "Test plan",
  full_book_summary: "Test summary",
  draft_file: "test/draft.md",
  covered_files: ["src/a.ts"],
  review_questions: ["Is it correct?"],
};

const passL0: ValidationReport = { target: "page", passed: true, errors: [], warnings: [] };
const failL0: ValidationReport = { target: "page", passed: false, errors: ["missing H1 title"], warnings: [] };
const passL1: ReviewResult = {
  success: true,
  conclusion: { verdict: "pass", blockers: [], factual_risks: [], missing_evidence: [], scope_violations: [], suggested_revisions: [] },
  metrics: { llmCalls: 1, usage: { inputTokens: 200, outputTokens: 50, reasoningTokens: 0, cachedTokens: 0 } },
};
const reviseL1: ReviewResult = {
  success: true,
  conclusion: { verdict: "revise", blockers: ["Scope drift"], factual_risks: [], missing_evidence: [], scope_violations: ["Discusses deployment"], suggested_revisions: [] },
  metrics: { llmCalls: 1, usage: { inputTokens: 200, outputTokens: 80, reasoningTokens: 0, cachedTokens: 0 } },
};
const passL2: ReviewResult = {
  success: true,
  conclusion: { verdict: "pass", blockers: [], factual_risks: [], missing_evidence: [], scope_violations: [], suggested_revisions: [] },
  metrics: { llmCalls: 1, usage: { inputTokens: 500, outputTokens: 200, reasoningTokens: 0, cachedTokens: 0 } },
};

describe("VerificationLadder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("L0 only: returns pass when validation passes, skips L1 and L2", async () => {
    mockValidatePage.mockReturnValue(passL0);

    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L0",
      briefing,
      draftContent: "# Title\nContent",
      validationInput: { markdown: "# Title\nContent", citations: [], knownFiles: ["src/a.ts"], knownPages: [], pageSlug: "test" },
    });

    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.levelReached).toBe("L0");
    expect(mockL1Review).not.toHaveBeenCalled();
    expect(mockL2Review).not.toHaveBeenCalled();
  });

  it("L0 only: returns revise with blockers when validation fails", async () => {
    mockValidatePage.mockReturnValue(failL0);

    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L0",
      briefing,
      draftContent: "no heading",
      validationInput: { markdown: "no heading", citations: [], knownFiles: [], knownPages: [], pageSlug: "test" },
    });

    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.blockers.length).toBeGreaterThan(0);
    expect(result.levelReached).toBe("L0");
  });

  it("L1: runs L0 then L1, merges results", async () => {
    mockValidatePage.mockReturnValue(passL0);
    mockL1Review.mockResolvedValue(passL1);

    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L1",
      briefing,
      draftContent: "# Title\nContent",
      validationInput: { markdown: "# Title\nContent", citations: [], knownFiles: [], knownPages: [], pageSlug: "test" },
    });

    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.levelReached).toBe("L1");
    expect(mockL1Review).toHaveBeenCalledOnce();
    expect(mockL2Review).not.toHaveBeenCalled();
  });

  it("L1 revise: propagates L1 blockers", async () => {
    mockValidatePage.mockReturnValue(passL0);
    mockL1Review.mockResolvedValue(reviseL1);

    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L1",
      briefing,
      draftContent: "# Title\nContent",
      validationInput: { markdown: "# Title\nContent", citations: [], knownFiles: [], knownPages: [], pageSlug: "test" },
    });

    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.blockers).toContain("Scope drift");
    expect(result.levelReached).toBe("L1");
  });

  it("L2: runs L0 + L1 + L2", async () => {
    mockValidatePage.mockReturnValue(passL0);
    mockL1Review.mockResolvedValue(passL1);
    mockL2Review.mockResolvedValue(passL2);

    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L2",
      briefing,
      draftContent: "# Title\nContent",
      validationInput: { markdown: "# Title\nContent", citations: [], knownFiles: [], knownPages: [], pageSlug: "test" },
    });

    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.levelReached).toBe("L2");
    expect(mockL1Review).toHaveBeenCalledOnce();
    expect(mockL2Review).toHaveBeenCalledOnce();
  });

  it("L2: short-circuits at L1 when L1 returns revise (no L2 waste)", async () => {
    mockValidatePage.mockReturnValue(passL0);
    mockL1Review.mockResolvedValue(reviseL1);

    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L2",
      briefing,
      draftContent: "# Title\nContent",
      validationInput: { markdown: "# Title\nContent", citations: [], knownFiles: [], knownPages: [], pageSlug: "test" },
    });

    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.levelReached).toBe("L1");
    expect(mockL2Review).not.toHaveBeenCalled();
  });

  it("L0 failure with L1 selected: merges L0 errors as blockers, still runs L1", async () => {
    mockValidatePage.mockReturnValue(failL0);
    mockL1Review.mockResolvedValue(passL1);

    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L1",
      briefing,
      draftContent: "no heading",
      validationInput: { markdown: "no heading", citations: [], knownFiles: [], knownPages: [], pageSlug: "test" },
    });

    // L0 errors become blockers → verdict is revise even though L1 passed
    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.blockers.some(b => b.includes("missing H1 title"))).toBe(true);
    expect(result.levelReached).toBe("L1");
  });

  it("accumulates metrics across levels", async () => {
    mockValidatePage.mockReturnValue(passL0);
    mockL1Review.mockResolvedValue(passL1);
    mockL2Review.mockResolvedValue(passL2);

    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L2",
      briefing,
      draftContent: "# Title\nContent",
      validationInput: { markdown: "# Title\nContent", citations: [], knownFiles: [], knownPages: [], pageSlug: "test" },
    });

    // L1 (200 in + 50 out) + L2 (500 in + 200 out)
    expect(result.metrics!.llmCalls).toBe(2);
    expect(result.metrics!.usage.inputTokens).toBe(700);
    expect(result.metrics!.usage.outputTokens).toBe(250);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run packages/core/src/review/__tests__/verification-ladder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/review/verification-ladder.ts
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
  /** Max tool-call steps for L2 (FreshReviewer). Defaults to 10. */
  l2MaxSteps?: number;
  /** Min citations for L2 verification. Defaults to 0. */
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

/**
 * Orchestrates L0 → L1 → L2 verification in sequence, short-circuiting
 * when the selected level is reached or an earlier level returns "revise".
 */
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

    // Accumulated metrics across all levels
    const totalMetrics: { llmCalls: number; usage: UsageInput } = {
      llmCalls: 0,
      usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 },
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
      totalMetrics.usage.reasoningTokens += l1Result.metrics.usage.reasoningTokens;
      totalMetrics.usage.cachedTokens += l1Result.metrics.usage.cachedTokens;
    }

    // Merge L0 blockers into L1 conclusion
    const l1Conclusion = l1Result.conclusion ?? {
      verdict: "pass" as const,
      blockers: [],
      factual_risks: [],
      missing_evidence: [],
      scope_violations: [],
      suggested_revisions: [],
    };
    const mergedBlockers = [...l0Blockers, ...l1Conclusion.blockers];
    const mergedVerdict = mergedBlockers.length > 0 ? "revise" : l1Conclusion.verdict;

    // If L1 (or L0) says revise, or we only wanted L1 — return merged result
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
      totalMetrics.usage.reasoningTokens += l2Result.metrics.usage.reasoningTokens;
      totalMetrics.usage.cachedTokens += l2Result.metrics.usage.cachedTokens;
    }

    // L2 conclusion is authoritative — merge L0 warnings as suggestions
    const l2Conclusion = l2Result.conclusion ?? l1Conclusion;
    const finalBlockers = [...l0Blockers, ...l2Conclusion.blockers];
    const finalVerdict = finalBlockers.length > 0 ? "revise" : l2Conclusion.verdict;

    return {
      success: l2Result.success,
      conclusion: {
        ...l2Conclusion,
        verdict: finalVerdict,
        blockers: finalBlockers,
        suggested_revisions: [
          ...l0Result.warnings.map((w) => `[L0] ${w}`),
          ...l2Conclusion.suggested_revisions,
        ],
      },
      metrics: totalMetrics,
      levelReached: "L2",
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run packages/core/src/review/__tests__/verification-ladder.test.ts`
Expected: ALL PASS (8 tests)

- [ ] **Step 5: Update the review index**

Modify `packages/core/src/review/index.ts`:

```typescript
// packages/core/src/review/index.ts
export { FreshReviewer } from "./reviewer.js";
export type { ReviewResult, FreshReviewerOptions } from "./reviewer.js";
export { buildReviewerSystemPrompt, buildReviewerUserPrompt } from "./reviewer-prompt.js";
export { L1SemanticReviewer } from "./l1-semantic-reviewer.js";
export type { L1SemanticReviewerOptions } from "./l1-semantic-reviewer.js";
export { VerificationLadder } from "./verification-ladder.js";
export type { VerificationLadderOptions, LadderVerifyInput, LadderResult } from "./verification-ladder.js";
export { selectVerificationLevel } from "./verification-level.js";
export type { VerificationLevel, VerificationLevelInput } from "./verification-level.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/review/verification-ladder.ts packages/core/src/review/__tests__/verification-ladder.test.ts packages/core/src/review/index.ts
git commit -m "feat(review): add VerificationLadder orchestrator — L0→L1→L2 with short-circuit"
```

---

### Task 4: Add `verificationLevel` to Throughput Metrics

**Files:**
- Modify: `packages/core/src/generation/throughput-metrics.ts:22-37`

Add a `verificationLevel` field to `PageThroughputRecord` so throughput.json shows which level each page was verified at. This is essential for observability — you can see how much review cost was saved.

- [ ] **Step 1: Write the failing test**

```typescript
// Add to existing throughput tests or create packages/core/src/generation/__tests__/throughput-verification-level.test.ts
import { describe, it, expect } from "vitest";
import type { PageThroughputRecord } from "../throughput-metrics.js";

describe("PageThroughputRecord with verificationLevel", () => {
  it("accepts verificationLevel field", () => {
    const record: PageThroughputRecord = {
      pageSlug: "test",
      lane: "fast",
      totalLatencyMs: 1000,
      revisionAttempts: 0,
      escalatedToDeepLane: false,
      verificationLevel: "L0",
      phases: {
        evidence: { llmCalls: 0, durationMs: 0, usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 } },
        outline: { llmCalls: 0, durationMs: 0, usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 } },
        draft: { llmCalls: 1, durationMs: 500, usage: { inputTokens: 100, outputTokens: 200, reasoningTokens: 0, cachedTokens: 0 } },
        review: { llmCalls: 0, durationMs: 50, usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 } },
        validate: { llmCalls: 0, durationMs: 10, usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 } },
      },
      usage: { inputTokens: 100, outputTokens: 200, reasoningTokens: 0, cachedTokens: 0, requests: 1 },
    };
    expect(record.verificationLevel).toBe("L0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run packages/core/src/generation/__tests__/throughput-verification-level.test.ts`
Expected: FAIL — Property 'verificationLevel' does not exist

- [ ] **Step 3: Add the field to `PageThroughputRecord`**

In `packages/core/src/generation/throughput-metrics.ts`, add `verificationLevel` to the `PageThroughputRecord` type:

```typescript
// Change the PageThroughputRecord type (lines ~22-37)
import type { VerificationLevel } from "../review/verification-level.js";

/** Per-page throughput record with phase-level breakdown. */
export type PageThroughputRecord = {
  pageSlug: string;
  lane: ExecutionLane;
  totalLatencyMs: number;
  revisionAttempts: number;
  escalatedToDeepLane: boolean;
  /** Which verification level was actually reached for this page. */
  verificationLevel?: VerificationLevel;
  phases: {
    evidence: PhaseMetric;
    outline: PhaseMetric;
    draft: PhaseMetric;
    review: PhaseMetric;
    validate: PhaseMetric;
  };
  usage: UsageBucket;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run packages/core/src/generation/__tests__/throughput-verification-level.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to check no regressions**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/generation/throughput-metrics.ts packages/core/src/generation/__tests__/throughput-verification-level.test.ts
git commit -m "feat(metrics): add verificationLevel field to PageThroughputRecord"
```

---

### Task 5: Integrate Verification Ladder into Generation Pipeline

**Files:**
- Modify: `packages/core/src/generation/generation-pipeline.ts`

This is the integration task. Replace the direct `FreshReviewer` call with `VerificationLadder`. The key changes:

1. Import `VerificationLadder`, `selectVerificationLevel`, and `VerificationLevel`
2. Create a `VerificationLadder` instance instead of bare `FreshReviewer`
3. Before the review section, call `selectVerificationLevel()` to determine the level
4. Replace `reviewer.review(briefing)` with `ladder.verify({ level, briefing, draftContent, validationInput })`
5. Move `validatePage()` call out of the post-loop validate section (it's now inside the ladder)
6. Record `verificationLevel` in the page throughput record

**Important constraint:** The existing `FreshReviewer` instance (`reviewer`) is constructed once before the page loop at line ~215. The `VerificationLadder` should be constructed the same way. The per-page level selection happens inside `runPageWorkflow()`.

- [ ] **Step 1: Import the new modules**

At the top of `generation-pipeline.ts`, add:

```typescript
import { VerificationLadder, type LadderResult } from "../review/verification-ladder.js";
import { selectVerificationLevel, type VerificationLevel } from "../review/verification-level.js";
```

Remove the direct FreshReviewer import (it's now encapsulated inside the ladder):

```typescript
// REMOVE: import { FreshReviewer } from "../review/reviewer.js";
```

- [ ] **Step 2: Replace FreshReviewer construction with VerificationLadder**

Replace the `reviewer` construction (~line 215-224) with:

```typescript
const ladder = new VerificationLadder({
  reviewerModel: this.reviewerModel,
  repoRoot: this.repoRoot,
  l2MaxSteps: qp.reviewerMaxSteps,
  l2VerifyMinCitations: qp.reviewerVerifyMinCitations,
  strictness: qp.reviewerStrictness,
  allowBash,
  providerCallOptions: reviewerProviderOpts,
  onStep: (step) => this.usageTracker.add("reviewer", (this.reviewerModel as unknown as { modelId?: string }).modelId ?? "unknown", step),
});
```

Update `runPageWorkflow` signature to accept `ladder: VerificationLadder` instead of `reviewer: FreshReviewer`.

- [ ] **Step 3: Replace the review call with ladder.verify()**

In `runPageWorkflow`, after the draft is saved to disk and before the review section (~line 766-777), replace:

```typescript
// OLD:
reviewResult = await reviewer.review(briefing);

// NEW:
const verificationLevel = selectVerificationLevel({
  lane,
  complexityScore: complexity.score,
  signals: runtimeSignals,
  revisionAttempt: attempt,
});

const ladderResult = await ladder.verify({
  level: verificationLevel,
  briefing,
  draftContent: draftResult.markdown!,
  validationInput: {
    markdown: draftResult.markdown!,
    citations: draftResult.metadata!.citations,
    knownFiles: page.covered_files,
    knownPages,
    pageSlug: page.slug,
  },
});
reviewResult = ladderResult;
currentVerificationLevel = ladderResult.levelReached;
```

Add `let currentVerificationLevel: VerificationLevel = "L0";` near the other `let` declarations at the top of `runPageWorkflow`.

- [ ] **Step 4: Move validate phase — L0 is now inside the ladder**

The existing `validatePage()` call after the review loop (~line 846-860) is now redundant for the case where `level >= L1` (L0 already ran inside the ladder). But the validate phase still needs to run independently for the throughput record. To keep it simple and backward-compatible:

Keep the existing `validatePage()` call as-is. The ladder's L0 acts as a review-time gate, while the post-loop validate phase records the final state for the page meta. This is intentionally redundant — L0 inside the ladder catches errors before the LLM review runs, while the final validate captures the post-revision state. The cost is negligible (pure CPU, no LLM).

- [ ] **Step 5: Record verificationLevel in page throughput record**

In the page throughput record construction (~line 938-952), add:

```typescript
const pageMetrics: PageThroughputRecord = {
  pageSlug: page.slug,
  lane,
  totalLatencyMs: Date.now() - pageStartedAt,
  revisionAttempts: attempt,
  escalatedToDeepLane: lane === "deep" && initialLane !== "deep",
  verificationLevel: currentVerificationLevel,
  phases: {
    evidence: evidenceMetric,
    outline: outlineMetric,
    draft: draftMetric,
    review: reviewMetric,
    validate: validateMetric,
  },
  usage: pageUsage,
};
```

Also update `buildPartialPageMetrics()` to accept and pass through `verificationLevel`.

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run`
Expected: ALL PASS

- [ ] **Step 7: Run typecheck**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx tsc -p packages/core/tsconfig.json --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/generation/generation-pipeline.ts
git commit -m "feat(pipeline): integrate VerificationLadder — L0/L1/L2 gated review per page"
```

---

### Task 6: Integration Test — End-to-End Verification Ladder

**Files:**
- Create: `packages/core/src/review/__tests__/verification-ladder-integration.test.ts`

Write integration tests that verify the full ladder behavior end-to-end with mocked LLM calls but real `validatePage()`.

- [ ] **Step 1: Write integration tests**

```typescript
// packages/core/src/review/__tests__/verification-ladder-integration.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VerificationLadder } from "../verification-ladder.js";
import type { ReviewBriefing } from "../../types/review.js";

vi.mock("ai", () => {
  const generateText = vi.fn();
  return {
    generateText,
    streamText: vi.fn((...args: unknown[]) => {
      const p = generateText(...args);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const safe = (fn: (r: any) => any) => { const q = p.then(fn); q.catch(() => {}); return q; };
      return {
        text: safe((r) => r?.text ?? ""),
        finishReason: safe((r) => r?.finishReason ?? "stop"),
        usage: safe((r) => r?.usage ?? {}),
        toolCalls: safe((r) => r?.toolCalls ?? []),
        toolResults: safe((r) => r?.toolResults ?? []),
        steps: safe((r) => r?.steps ?? []),
        response: safe((r) => r?.response ?? {}),
        fullStream: (async function* () { const r = await p; if (r?.text) yield { type: "text-delta", textDelta: r.text }; })(),
      };
    }),
    jsonSchema: vi.fn((s: unknown) => s),
    stepCountIs: vi.fn(() => () => false),
  };
});

const briefing: ReviewBriefing = {
  page_title: "Test Page",
  section_position: "Page 1 of 3",
  current_page_plan: "Explain the test system",
  full_book_summary: "A wiki about testing",
  draft_file: "test/draft.md",
  covered_files: ["src/test.ts"],
  review_questions: ["Is it correct?"],
};

describe("VerificationLadder integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("L0 catches structural error without any LLM call", async () => {
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });

    // No H1 heading → structure validator fails
    const result = await ladder.verify({
      level: "L0",
      briefing,
      draftContent: "no heading here",
      validationInput: {
        markdown: "no heading here",
        citations: [],
        knownFiles: [],
        knownPages: [],
        pageSlug: "test",
      },
    });

    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.blockers.some(b => b.includes("missing H1 title"))).toBe(true);
    expect(result.metrics!.llmCalls).toBe(0);
  });

  it("L0 pass with valid structure, no LLM call", async () => {
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await ladder.verify({
      level: "L0",
      briefing,
      draftContent: "# Test Page\n\nSome content that is long enough to pass the minimum length check for structure validation.",
      validationInput: {
        markdown: "# Test Page\n\nSome content that is long enough to pass the minimum length check for structure validation.",
        citations: [],
        knownFiles: [],
        knownPages: [],
        pageSlug: "test",
      },
    });

    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.metrics!.llmCalls).toBe(0);
  });

  it("L1 makes exactly 1 LLM call", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: "pass",
        blockers: [],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        suggested_revisions: [],
      }),
      usage: { inputTokens: 300, outputTokens: 80 },
    } as never);

    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await ladder.verify({
      level: "L1",
      briefing,
      draftContent: "# Test Page\n\n## Section\nContent with [cite:file:src/test.ts:1-10].",
      validationInput: {
        markdown: "# Test Page\n\n## Section\nContent with [cite:file:src/test.ts:1-10].",
        citations: [{ kind: "file", target: "src/test.ts", locator: "1-10" }],
        knownFiles: ["src/test.ts"],
        knownPages: [],
        pageSlug: "test",
      },
    });

    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.metrics!.llmCalls).toBe(1);
    expect(result.levelReached).toBe("L1");
  });

  it("L2 makes 2 LLM calls (L1 + L2) when L1 passes", async () => {
    const { generateText } = await import("ai");
    // L1 call
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({ verdict: "pass", blockers: [], factual_risks: [], missing_evidence: [], scope_violations: [], suggested_revisions: [] }),
      usage: { inputTokens: 300, outputTokens: 80 },
    } as never);
    // L2 call
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({ verdict: "pass", blockers: [], factual_risks: [], missing_evidence: [], scope_violations: [], suggested_revisions: [] }),
      usage: { inputTokens: 600, outputTokens: 150 },
    } as never);

    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await ladder.verify({
      level: "L2",
      briefing,
      draftContent: "# Test Page\n\n## Section\nContent with [cite:file:src/test.ts:1-10].",
      validationInput: {
        markdown: "# Test Page\n\n## Section\nContent with [cite:file:src/test.ts:1-10].",
        citations: [{ kind: "file", target: "src/test.ts", locator: "1-10" }],
        knownFiles: ["src/test.ts"],
        knownPages: [],
        pageSlug: "test",
      },
    });

    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.metrics!.llmCalls).toBe(2);
    expect(result.levelReached).toBe("L2");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run packages/core/src/review/__tests__/verification-ladder-integration.test.ts`
Expected: ALL PASS (4 tests)

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/review/__tests__/verification-ladder-integration.test.ts
git commit -m "test(review): add integration tests for VerificationLadder end-to-end"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] L0 Deterministic Validation — reuses `validatePage()` (structure, citations, mermaid, links)
- [x] L1 Cheap Semantic Review — new `L1SemanticReviewer` (scope drift, citation density, unsupported claims)
- [x] L2 Expensive Factual Review — existing `FreshReviewer` (deep evidence verification with tools)
- [x] Upgrade conditions: complexity ≥ 12, deep lane, factualRisks > 0, missingEvidence > 0, draftTruncated, revision > 1, lowCitationDensity
- [x] Short-circuit: L1 revise skips L2
- [x] Observability: `verificationLevel` in throughput record

**2. Placeholder scan:** No TBDs, TODOs, or vague steps. All code is complete.

**3. Type consistency:** `VerificationLevel`, `selectVerificationLevel`, `VerificationLadder`, `LadderResult`, `LadderVerifyInput` — all consistent across tasks. `ReviewResult` reused from existing type.
