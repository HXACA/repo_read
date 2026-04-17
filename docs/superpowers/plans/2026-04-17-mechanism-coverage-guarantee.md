# Mechanism Coverage Guarantee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a recall-oriented check so drafters cannot silently omit mechanisms discovered in the evidence ledger. Outline planner must allocate every mechanism; reviewer reports `missing_coverage`; pipeline triggers re-draft (but not re-evidence) when gaps exist. Three-tier rollout via `qp.coverageEnforcement` (`off` / `warn` / `strict`).

**Architecture:** New `deriveMechanismList()` translates the evidence ledger into a `Mechanism[]` list. Outline planner binds every mechanism to a section (`covers_mechanisms`) or declares it out-of-scope with a reason. Drafter receives the list as an anchor in `authorContext`. Reviewer checks each mechanism against the draft and returns `missing_coverage: string[]`. Pipeline routes `missing_coverage` as a revision trigger independent of `missing_evidence` — re-draft only, never re-collect evidence.

**Tech Stack:** TypeScript strict, Vitest, pnpm workspace, existing `EvidenceCoordinator` / `OutlinePlanner` / `PageDrafter` / `VerificationLadder` / `GenerationPipeline`.

---

## File Structure

### Create

- `packages/core/src/generation/mechanism-list.ts` — `Mechanism` type + `deriveMechanismList()` pure function.
- `packages/core/src/generation/__tests__/mechanism-list.test.ts` — unit tests for derivation.
- `packages/core/src/generation/__tests__/coverage-integration.test.ts` — end-to-end pipeline test for the coverage flow.

### Modify

- `packages/core/src/config/quality-profile.ts` + `__tests__/quality-profile.test.ts` — add `coverageEnforcement` field with four preset defaults.
- `packages/core/src/types/agent.ts` — extend `PageOutline` with `covers_mechanisms` and `out_of_scope_mechanisms`.
- `packages/core/src/types/review.ts` — add `missing_coverage` to `ReviewConclusion`.
- `packages/core/src/generation/outline-planner.ts` + `__tests__/outline-planner.test.ts` — accept `mechanisms`; prompt block; validation; 1-shot retry; forced allocation fallback.
- `packages/core/src/generation/page-drafter.ts` + `page-drafter-prompt.ts` — inject `MECHANISMS TO COVER` section in author context.
- `packages/core/src/review/reviewer-prompt.ts` + `l1-semantic-prompt.ts` — add coverage prompt block; schema update in response example.
- `packages/core/src/review/reviewer.ts` + `l1-semantic-reviewer.ts` — parse `missing_coverage`; upgrade to blockers; `parseOutput` defaults.
- `packages/core/src/review/verification-ladder.ts` — merge `missing_coverage` across L1/L2.
- `packages/core/src/generation/generation-pipeline.ts` — derive mechanism list after evidence; pass to outline/drafter/reviewer; route `missing_coverage` into revision (not re-evidence); fill coverage metrics; persist `coverageBlockers`.
- `packages/core/src/generation/throughput-metrics.ts` — new `PageThroughputRecord.coverage` + `ThroughputReport.coverageAudit`.
- `packages/core/src/generation/page-prefetcher.ts` — derive mechanisms in prefetch so the main path can inherit.
- `packages/core/src/artifacts/artifact-store.ts` — save `pageMeta.coverageBlockers` via existing `savePageMeta` (type update only).
- `packages/cli/src/commands/generate.tsx` + `packages/cli/src/cli.tsx` — `--coverage-enforcement <off|warn|strict>` flag wiring.

### Out of Scope

- Catalog-layer topic stability (cross-run guarantees).
- Evidence recall improvements.
- Non-LLM symbol extraction (AST).
- Web UI surfacing of coverage blockers.

---

## Phase A — Foundation Types

### Task 1: `QualityProfile.coverageEnforcement` field

**Files:**
- Modify: `packages/core/src/config/quality-profile.ts`
- Modify: `packages/core/src/config/__tests__/quality-profile.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/config/__tests__/quality-profile.test.ts`:

```typescript
  it("every preset defines coverageEnforcement", () => {
    for (const preset of ["quality", "balanced", "budget", "local-only"] as const) {
      const p = getQualityProfile(preset);
      expect(["off", "warn", "strict"]).toContain(p.coverageEnforcement);
    }
  });

  it("quality preset defaults coverageEnforcement to 'warn' (phase 1 rollout)", () => {
    expect(getQualityProfile("quality").coverageEnforcement).toBe("warn");
  });

  it("budget and local-only presets default coverageEnforcement to 'off'", () => {
    expect(getQualityProfile("budget").coverageEnforcement).toBe("off");
    expect(getQualityProfile("local-only").coverageEnforcement).toBe("off");
  });
```

- [ ] **Step 2: Run the test, confirm FAIL**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- quality-profile`
Expected: FAIL — `coverageEnforcement` is `undefined`.

- [ ] **Step 3: Extend the QualityProfile type**

In `packages/core/src/config/quality-profile.ts`, add to the `QualityProfile` type (right after `pageConcurrency`):

```typescript
  /**
   * Controls the mechanism-coverage recall check.
   *
   * - `off`: mechanism list is not derived; outline/drafter/reviewer unchanged.
   * - `warn`: mechanism list is derived and observed, but a non-empty
   *   `missing_coverage` does NOT trigger revision (metrics only).
   * - `strict`: `missing_coverage` behaves like `missing_evidence` — triggers
   *   a re-draft. Never triggers evidence re-collection.
   */
  coverageEnforcement: "off" | "warn" | "strict";
```

- [ ] **Step 4: Set default on each preset**

In the same file, add to each of the 4 presets inside `QUALITY_PROFILES`:

- `quality`: `coverageEnforcement: "warn"`
- `balanced`: `coverageEnforcement: "off"`
- `budget`: `coverageEnforcement: "off"`
- `"local-only"`: `coverageEnforcement: "off"`

- [ ] **Step 5: Run the test, confirm PASS**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- quality-profile`
Expected: PASS (3 new tests + existing ones).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config/quality-profile.ts packages/core/src/config/__tests__/quality-profile.test.ts
git commit -m "$(cat <<'EOF'
feat(quality-profile): add coverageEnforcement field (off/warn/strict)

quality preset defaults to 'warn' for phase 1 observation; other presets
default to 'off' (preserve legacy behavior). Consumed by outline/drafter/
reviewer/pipeline in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `Mechanism` type + `deriveMechanismList()` module

**Files:**
- Create: `packages/core/src/generation/mechanism-list.ts`
- Create: `packages/core/src/generation/__tests__/mechanism-list.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/generation/__tests__/mechanism-list.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { deriveMechanismList, type Mechanism } from "../mechanism-list.js";

type LedgerEntry = { id: string; kind: "file" | "page" | "commit"; target: string; note: string };

function L(target: string, note: string, id = target, kind: LedgerEntry["kind"] = "file"): LedgerEntry {
  return { id, kind, target, note };
}

describe("deriveMechanismList", () => {
  it("returns empty array when ledger is empty", () => {
    expect(deriveMechanismList([], [])).toEqual([]);
  });

  it("filters out entries with empty note (trivial citations)", () => {
    const ledger: LedgerEntry[] = [
      L("src/a.ts", ""),
      L("src/b.ts", "  "),
      L("src/c.ts", "defines Foo class"),
    ];
    const result = deriveMechanismList(ledger, ["src/c.ts"]);
    expect(result.map((m) => m.citation.target)).toEqual(["src/c.ts"]);
  });

  it("deduplicates by citation.target, keeps first entry", () => {
    const ledger: LedgerEntry[] = [
      L("src/a.ts", "first note"),
      L("src/a.ts", "second note"),
      L("src/b.ts", "b note"),
    ];
    const result = deriveMechanismList(ledger, ["src/a.ts", "src/b.ts"]);
    expect(result).toHaveLength(2);
    expect(result.find((m) => m.citation.target === "src/a.ts")!.description).toBe("first note");
  });

  it("assigns must_cite when target is in coveredFiles, must_mention otherwise", () => {
    const ledger: LedgerEntry[] = [
      L("src/covered.ts", "inside scope"),
      L("src/helper.ts", "worker discovered"),
    ];
    const result = deriveMechanismList(ledger, ["src/covered.ts"]);
    expect(result.find((m) => m.citation.target === "src/covered.ts")!.coverageRequirement).toBe("must_cite");
    expect(result.find((m) => m.citation.target === "src/helper.ts")!.coverageRequirement).toBe("must_mention");
  });

  it("caps the list at 30 entries, longest descriptions first", () => {
    const ledger: LedgerEntry[] = [];
    for (let i = 0; i < 40; i++) {
      ledger.push(L(`src/file${i}.ts`, `note length ${i} ${"x".repeat(i)}`));
    }
    const result = deriveMechanismList(ledger, []);
    expect(result).toHaveLength(30);
    // Ensure first entries have the longest descriptions
    expect(result[0].description.length).toBeGreaterThanOrEqual(result[29].description.length);
  });

  it("truncates description at 120 chars", () => {
    const ledger: LedgerEntry[] = [L("src/a.ts", "a".repeat(300))];
    const result = deriveMechanismList(ledger, []);
    expect(result[0].description.length).toBe(120);
  });

  it("builds id with kind, target, and optional locator", () => {
    const ledger: LedgerEntry[] = [
      { id: "1", kind: "file", target: "src/publisher.ts", note: "publishes versions" },
    ];
    const result = deriveMechanismList(ledger, ["src/publisher.ts"]);
    expect(result[0].id).toBe("file:src/publisher.ts");
  });

  it("returns Mechanism objects with citation preserving kind", () => {
    const ledger: LedgerEntry[] = [
      { id: "1", kind: "page", target: "other-page-slug", note: "related page" },
    ];
    const result: Mechanism[] = deriveMechanismList(ledger, []);
    expect(result[0].citation.kind).toBe("page");
    expect(result[0].citation.target).toBe("other-page-slug");
  });
});
```

- [ ] **Step 2: Run the test, confirm FAIL**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- mechanism-list`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `deriveMechanismList`**

Create `packages/core/src/generation/mechanism-list.ts`:

```typescript
/**
 * Derives a deduplicated list of mechanisms from the evidence ledger.
 * Used by outline, drafter, and reviewer to enforce recall-oriented
 * coverage — nothing in the ledger (with a non-empty note) may be silently
 * skipped by the drafter.
 */

export type Mechanism = {
  /** Stable identifier, formed from citation kind + target (+ locator if present). */
  id: string;
  citation: {
    kind: "file" | "page" | "commit";
    target: string;
    locator?: string;
  };
  /** Short human-readable description, truncated to 120 chars. */
  description: string;
  /**
   * - `must_cite`: the draft must include a `[cite:...]` marker referencing
   *   this citation (target in page.covered_files).
   * - `must_mention`: the draft must mention the target name or description
   *   keywords (worker-discovered, outside covered_files).
   */
  coverageRequirement: "must_cite" | "must_mention";
};

type LedgerLike = {
  id?: string;
  kind: "file" | "page" | "commit" | string;
  target: string;
  note: string;
  locator?: string;
};

const MAX_MECHANISMS = 30;
const MAX_DESCRIPTION_LENGTH = 120;

export function deriveMechanismList(
  ledger: ReadonlyArray<LedgerLike>,
  coveredFiles: ReadonlyArray<string>,
): Mechanism[] {
  const coveredSet = new Set(coveredFiles);
  const seenTargets = new Set<string>();
  const out: Mechanism[] = [];

  for (const entry of ledger) {
    const note = (entry.note ?? "").trim();
    if (!note) continue;
    if (seenTargets.has(entry.target)) continue;
    seenTargets.add(entry.target);

    const kind = normalizeKind(entry.kind);
    const id = buildId(kind, entry.target, entry.locator);
    const description = note.length > MAX_DESCRIPTION_LENGTH
      ? note.slice(0, MAX_DESCRIPTION_LENGTH)
      : note;

    out.push({
      id,
      citation: {
        kind,
        target: entry.target,
        ...(entry.locator ? { locator: entry.locator } : {}),
      },
      description,
      coverageRequirement: coveredSet.has(entry.target) ? "must_cite" : "must_mention",
    });
  }

  // Sort by description length descending (longest first = most informative)
  out.sort((a, b) => b.description.length - a.description.length);

  if (out.length > MAX_MECHANISMS) {
    return out.slice(0, MAX_MECHANISMS);
  }
  return out;
}

function normalizeKind(kind: string): "file" | "page" | "commit" {
  return kind === "page" || kind === "commit" ? kind : "file";
}

function buildId(kind: string, target: string, locator: string | undefined): string {
  return locator ? `${kind}:${target}#${locator}` : `${kind}:${target}`;
}
```

- [ ] **Step 4: Run the test, confirm PASS**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- mechanism-list`
Expected: PASS (8 tests).

- [ ] **Step 5: Run full core suite to ensure no regressions**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/generation/mechanism-list.ts packages/core/src/generation/__tests__/mechanism-list.test.ts
git commit -m "$(cat <<'EOF'
feat(generation): add deriveMechanismList + Mechanism type

Filters ledger entries with non-empty notes, dedups by target, truncates
descriptions to 120 chars, caps at 30 entries. must_cite vs must_mention
is determined by whether the target appears in page.covered_files.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Extend `PageOutline` schema

**Files:**
- Modify: `packages/core/src/types/agent.ts`

- [ ] **Step 1: Add `covers_mechanisms` and `out_of_scope_mechanisms`**

In `packages/core/src/types/agent.ts`, extend `PageOutlineSection` and `PageOutline`:

```typescript
export type PageOutline = {
  sections: PageOutlineSection[];
  /**
   * Mechanisms the outline planner declared out of scope for this page,
   * with a short reason (typically referencing where the mechanism is
   * covered instead). Empty when coverageEnforcement is "off".
   */
  out_of_scope_mechanisms?: Array<{ id: string; reason: string }>;
};

export type PageOutlineSection = {
  /** The `##` heading text (e.g. "核心架构"). */
  heading: string;
  /** 2-5 bullet points the section should cover. */
  key_points: string[];
  /** Evidence entries the drafter MUST cite in this section. */
  cite_from: Array<{ target: string; locator?: string }>;
  /**
   * Mechanism ids (see `deriveMechanismList`) this section is responsible
   * for covering. Empty when coverageEnforcement is "off".
   */
  covers_mechanisms?: string[];
};
```

Note: both new fields are optional for backward compatibility with `"off"` mode and existing stored outlines.

- [ ] **Step 2: Run typecheck to ensure nothing breaks**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core typecheck`
Expected: No errors (fields are optional).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/agent.ts
git commit -m "$(cat <<'EOF'
feat(types): extend PageOutline with covers_mechanisms + out_of_scope_mechanisms

Both fields are optional — preserves backward compatibility with on-disk
outlines from previous runs. Populated by OutlinePlanner when coverageEnforcement != "off".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Add `missing_coverage` to `ReviewConclusion`

**Files:**
- Modify: `packages/core/src/types/review.ts`

- [ ] **Step 1: Add field**

In `packages/core/src/types/review.ts`, extend `ReviewConclusion`:

```typescript
export type ReviewConclusion = {
  verdict: ReviewVerdict;
  blockers: string[];
  factual_risks: string[];
  missing_evidence: string[];
  scope_violations: string[];
  /**
   * Mechanism ids the reviewer judged as not adequately covered in the
   * draft. Derived from `deriveMechanismList` and pre-filtered to exclude
   * items the outline declared out-of-scope. Non-empty in strict mode
   * forces `verdict = "revise"` and triggers a re-draft (never re-evidence).
   * Older review.json files will not have this field.
   */
  missing_coverage?: string[];
  suggested_revisions: string[];
  verified_citations?: VerifiedCitation[];
};
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core typecheck`
Expected: No errors (field is optional).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/review.ts
git commit -m "$(cat <<'EOF'
feat(types): add missing_coverage to ReviewConclusion (optional)

Reviewer returns the list of mechanism ids not covered in the draft.
Optional for backward compatibility with stored review.json.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — Outline Planner Integration

### Task 5: `OutlinePlanner` accepts mechanisms; prompt and fallback

**Files:**
- Modify: `packages/core/src/generation/outline-planner.ts`
- Modify: `packages/core/src/generation/__tests__/outline-planner.test.ts`

- [ ] **Step 1: Write failing tests**

Read the existing test file to see the mock pattern:

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && head -80 packages/core/src/generation/__tests__/outline-planner.test.ts`

Append these test cases to `packages/core/src/generation/__tests__/outline-planner.test.ts` (reuse the existing mock setup at the top of the file; if helper functions for mocking don't exist, replicate the minimal pattern from the first test). Place the new block inside the existing `describe` that wraps the existing tests, or create a sibling describe:

```typescript
import type { Mechanism } from "../mechanism-list.js";

describe("OutlinePlanner mechanism coverage", () => {
  it("accepts mechanisms and renders them into the prompt", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    const validOutline = JSON.stringify({
      sections: [
        { heading: "A", key_points: ["k1"], cite_from: [], covers_mechanisms: ["file:x.ts"] },
        { heading: "B", key_points: ["k2"], cite_from: [], covers_mechanisms: [] },
      ],
      out_of_scope_mechanisms: [],
    });
    mockGenerateText.mockResolvedValueOnce({
      text: validOutline,
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    const mechanisms: Mechanism[] = [
      { id: "file:x.ts", citation: { kind: "file", target: "x.ts" }, description: "the X thing", coverageRequirement: "must_cite" },
    ];

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.planWithMetrics({
      pageTitle: "Page",
      pageRationale: "r",
      coveredFiles: ["x.ts"],
      language: "en",
      ledger: [],
      findings: [],
      mechanisms,
    });

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt?: string; messages?: unknown[] };
    const promptText = (callArgs.prompt ?? JSON.stringify(callArgs.messages ?? "")).toString();
    expect(promptText).toContain("file:x.ts");
    expect(promptText).toContain("the X thing");
    expect(result.outline.sections[0].covers_mechanisms).toEqual(["file:x.ts"]);
  });

  it("retries with instruction when outline misses a mechanism", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // First call: outline missing m2
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        sections: [{ heading: "A", key_points: ["k"], cite_from: [], covers_mechanisms: ["file:m1"] }],
        out_of_scope_mechanisms: [],
      }),
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    // Retry: adds m2 to section
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        sections: [{ heading: "A", key_points: ["k"], cite_from: [], covers_mechanisms: ["file:m1", "file:m2"] }],
        out_of_scope_mechanisms: [],
      }),
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    const mechanisms: Mechanism[] = [
      { id: "file:m1", citation: { kind: "file", target: "m1" }, description: "m1", coverageRequirement: "must_cite" },
      { id: "file:m2", citation: { kind: "file", target: "m2" }, description: "m2", coverageRequirement: "must_cite" },
    ];

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.planWithMetrics({
      pageTitle: "Page",
      pageRationale: "r",
      coveredFiles: ["m1", "m2"],
      language: "en",
      ledger: [],
      findings: [],
      mechanisms,
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    expect(result.outline.sections[0].covers_mechanisms).toContain("file:m2");
  });

  it("forces allocation to last section when retry still misses a mechanism", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    const missingOutline = JSON.stringify({
      sections: [
        { heading: "A", key_points: ["k1"], cite_from: [], covers_mechanisms: ["file:m1"] },
        { heading: "B", key_points: ["k2"], cite_from: [], covers_mechanisms: [] },
      ],
      out_of_scope_mechanisms: [],
    });
    mockGenerateText.mockResolvedValueOnce({ text: missingOutline, usage: { inputTokens: 10, outputTokens: 5 } } as never);
    mockGenerateText.mockResolvedValueOnce({ text: missingOutline, usage: { inputTokens: 10, outputTokens: 5 } } as never);

    const mechanisms: Mechanism[] = [
      { id: "file:m1", citation: { kind: "file", target: "m1" }, description: "m1", coverageRequirement: "must_cite" },
      { id: "file:m2", citation: { kind: "file", target: "m2" }, description: "m2", coverageRequirement: "must_cite" },
    ];

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.planWithMetrics({
      pageTitle: "Page", pageRationale: "r", coveredFiles: ["m1", "m2"], language: "en",
      ledger: [], findings: [], mechanisms,
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(2); // retry attempted once
    // m2 force-allocated to last section
    expect(result.outline.sections[result.outline.sections.length - 1].covers_mechanisms).toContain("file:m2");
  });

  it("accepts out_of_scope declarations as valid coverage", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        sections: [{ heading: "A", key_points: ["k"], cite_from: [], covers_mechanisms: ["file:m1"] }],
        out_of_scope_mechanisms: [{ id: "file:m2", reason: "covered in another-page-slug" }],
      }),
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    const mechanisms: Mechanism[] = [
      { id: "file:m1", citation: { kind: "file", target: "m1" }, description: "m1", coverageRequirement: "must_cite" },
      { id: "file:m2", citation: { kind: "file", target: "m2" }, description: "m2", coverageRequirement: "must_cite" },
    ];

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.planWithMetrics({
      pageTitle: "Page", pageRationale: "r", coveredFiles: ["m1", "m2"], language: "en",
      ledger: [], findings: [], mechanisms,
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(1); // no retry needed
    expect(result.outline.out_of_scope_mechanisms).toEqual([{ id: "file:m2", reason: "covered in another-page-slug" }]);
  });

  it("omits mechanism-enforcement when mechanisms array is empty", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        sections: [{ heading: "A", key_points: ["k"], cite_from: [] }],
      }),
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.planWithMetrics({
      pageTitle: "Page", pageRationale: "r", coveredFiles: [], language: "en",
      ledger: [], findings: [], mechanisms: [],
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(result.outline.sections[0].heading).toBe("A");
  });
});
```

- [ ] **Step 2: Run tests, confirm FAIL**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- outline-planner`
Expected: FAIL — `mechanisms` is not a recognized `OutlinePlannerInput` field, and the planner does not render mechanism blocks.

- [ ] **Step 3: Extend `OutlinePlannerInput` type**

In `packages/core/src/generation/outline-planner.ts`, update the type (around line 9):

```typescript
import type { Mechanism } from "./mechanism-list.js";

export type OutlinePlannerInput = {
  pageTitle: string;
  pageRationale: string;
  coveredFiles: string[];
  language: string;
  ledger: Array<{ id: string; kind: string; target: string; note: string }>;
  findings: string[];
  /** When non-empty, outline MUST allocate each mechanism id to either
   *  `covers_mechanisms` on some section or `out_of_scope_mechanisms`. */
  mechanisms?: Mechanism[];
};
```

- [ ] **Step 4: Extend the prompt builder**

In the same file, find `buildUserPrompt(input)` around line 134. Add a mechanism block near the end (before the closing return). The exact shape of `buildUserPrompt` depends on current code. Read the function first:

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && sed -n '134,195p' packages/core/src/generation/outline-planner.ts`

Append a new section to the returned prompt string. After the existing content, add (inside the template literal or appended with `+=`):

```typescript
  private buildUserPrompt(input: OutlinePlannerInput): string {
    // ... existing body ...

    let prompt = /* existing */ ...;

    if (input.mechanisms && input.mechanisms.length > 0) {
      const mechBlock = input.mechanisms
        .map((m) => `- [${m.id}] ${m.description} (requirement: ${m.coverageRequirement})`)
        .join("\n");
      prompt += `

===== MECHANISMS =====
${mechBlock}

For every mechanism above, your outline MUST do ONE of the following:
A) Include its id in the "covers_mechanisms" array of some section whose "key_points" discuss it.
B) Include it in "out_of_scope_mechanisms" with a reason at least 10 characters long (typical phrasing: "covered in <other-slug>" or "out of scope for this page").

Never leave a mechanism unaccounted for. Return JSON matching:
{
  "sections": [{"heading":"","key_points":[],"cite_from":[],"covers_mechanisms":[]}],
  "out_of_scope_mechanisms": [{"id":"","reason":""}]
}
`;
    }
    return prompt;
  }
```

Adapt the merge to the actual return style (the function currently builds a single string).

- [ ] **Step 5: Add validation + 1-shot retry + fallback**

Still in `outline-planner.ts`, add a private helper and wire it into `planWithMetrics`. Replace the body of `planWithMetrics` (current body fetches LLM once and returns) with:

```typescript
  async planWithMetrics(input: OutlinePlannerInput): Promise<OutlinePlanResult> {
    const firstAttempt = await this.runLLM(input, /*retryNotice*/ undefined);
    const mechanisms = input.mechanisms ?? [];

    if (mechanisms.length === 0) {
      return firstAttempt; // legacy path, no coverage enforcement
    }

    const missingAfterFirst = findUncoveredMechanismIds(firstAttempt.outline, mechanisms);
    if (missingAfterFirst.length === 0) {
      return firstAttempt;
    }

    // One-shot retry: ask LLM to update the previous outline with the missing ids
    const retryAttempt = await this.runLLM(
      input,
      { previousOutline: firstAttempt.outline, missingIds: missingAfterFirst },
    );
    const combinedMetrics = {
      llmCalls: firstAttempt.metrics.llmCalls + retryAttempt.metrics.llmCalls,
      usage: sumUsage(firstAttempt.metrics.usage, retryAttempt.metrics.usage),
    };

    const missingAfterRetry = findUncoveredMechanismIds(retryAttempt.outline, mechanisms);
    if (missingAfterRetry.length === 0) {
      return { ...retryAttempt, metrics: combinedMetrics };
    }

    // Fallback: force-allocate missing ids to the last section's covers_mechanisms
    const forced = forceAllocateMechanisms(retryAttempt.outline, missingAfterRetry);
    return {
      outline: forced,
      usedFallback: true,
      metrics: combinedMetrics,
    };
  }
```

Add the helpers outside the class:

```typescript
function findUncoveredMechanismIds(outline: PageOutline, mechanisms: Mechanism[]): string[] {
  const claimed = new Set<string>();
  for (const section of outline.sections) {
    for (const id of section.covers_mechanisms ?? []) claimed.add(id);
  }
  for (const item of outline.out_of_scope_mechanisms ?? []) claimed.add(item.id);
  return mechanisms.map((m) => m.id).filter((id) => !claimed.has(id));
}

function forceAllocateMechanisms(outline: PageOutline, missingIds: string[]): PageOutline {
  const sections = outline.sections.length > 0
    ? outline.sections.map((s, i) => i === outline.sections.length - 1
      ? { ...s, covers_mechanisms: [...(s.covers_mechanisms ?? []), ...missingIds] }
      : s)
    : [{
        heading: "附录：未规划机制",
        key_points: ["以下机制在 outline 阶段未被正式分配到任何 section，由 drafter 自行判断如何展开"],
        cite_from: [],
        covers_mechanisms: missingIds,
      }];
  return { ...outline, sections };
}

function sumUsage(a: UsageInput, b: UsageInput): UsageInput {
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    reasoningTokens: (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0),
    cachedTokens: (a.cachedTokens ?? 0) + (b.cachedTokens ?? 0),
  };
}
```

Extract the existing LLM-call body into a private `runLLM(input, retry?)` method that returns `OutlinePlanResult`. For the retry path, prepend a notice to the prompt along the lines of:

```typescript
const retryNotice = retry
  ? `\n\n===== RETRY =====\nYour previous outline below is MISSING the following mechanism ids: ${retry.missingIds.join(", ")}.\nUpdate the outline to add each missing id — either to an existing section's covers_mechanisms or to out_of_scope_mechanisms with a reason. Keep the rest of the outline stable.\n\nPrevious outline (to amend):\n${JSON.stringify(retry.previousOutline, null, 2)}\n`
  : "";
```

- [ ] **Step 6: Update the outline JSON parsing to read new fields**

In the same file, find where LLM response is parsed into `PageOutline` (inside the existing `planWithMetrics` or a helper). Ensure parsing accepts:

- `covers_mechanisms` → `string[]` (default `[]` when missing)
- `out_of_scope_mechanisms` → `Array<{id: string; reason: string}>` (default `[]`)

Defensive parse:

```typescript
const rawSections = (data.sections ?? []) as Array<Record<string, unknown>>;
const sections: PageOutlineSection[] = rawSections.map((s) => ({
  heading: typeof s.heading === "string" ? s.heading : "",
  key_points: Array.isArray(s.key_points) ? (s.key_points as string[]) : [],
  cite_from: Array.isArray(s.cite_from) ? (s.cite_from as Array<{ target: string; locator?: string }>) : [],
  covers_mechanisms: Array.isArray(s.covers_mechanisms)
    ? (s.covers_mechanisms as unknown[]).filter((x): x is string => typeof x === "string")
    : [],
}));
const outOfScope = Array.isArray(data.out_of_scope_mechanisms)
  ? (data.out_of_scope_mechanisms as unknown[])
      .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
      .map((x) => ({
        id: typeof x.id === "string" ? x.id : "",
        reason: typeof x.reason === "string" ? x.reason : "",
      }))
      .filter((x) => x.id.length > 0)
  : [];
```

- [ ] **Step 7: Run tests, confirm PASS**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- outline-planner`
Expected: all new + existing tests pass.

- [ ] **Step 8: Run full suite**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/generation/outline-planner.ts packages/core/src/generation/__tests__/outline-planner.test.ts
git commit -m "$(cat <<'EOF'
feat(outline-planner): enforce mechanism coverage with retry + fallback

Outline planner now accepts a mechanisms array. Each mechanism MUST be
allocated to a section's covers_mechanisms or declared out_of_scope with
a reason. Misses trigger a 1-shot LLM retry; still-missing ids are
force-allocated to the last section (usedFallback=true).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — Reviewer Integration

### Task 6: Reviewer prompts and parsers add `missing_coverage`

**Files:**
- Modify: `packages/core/src/review/reviewer-prompt.ts`
- Modify: `packages/core/src/review/reviewer.ts`
- Modify: `packages/core/src/review/l1-semantic-prompt.ts`
- Modify: `packages/core/src/review/l1-semantic-reviewer.ts`

- [ ] **Step 1: Extend `ReviewBriefing` with mechanism list**

In `packages/core/src/types/review.ts`, add the import and extend `ReviewBriefing`:

```typescript
import type { Mechanism } from "../generation/mechanism-list.js";

export type ReviewBriefing = {
  // ...existing fields (page_title, section_position, ...)...
  /** Mechanisms the reviewer must audit for recall-based coverage. Empty
   *  when coverageEnforcement is "off". Pipeline pre-filters out any
   *  mechanism the outline declared out_of_scope. */
  mechanisms_to_verify?: Mechanism[];
};
```

This is a one-way dependency (`types/review.ts` → `generation/mechanism-list.ts`). It is safe because `generation/mechanism-list.ts` does not import from `types/review.ts` or anywhere else in types/ — it only declares its own `Mechanism` type and a pure function.

- [ ] **Step 2: Add `missing_coverage` clause to L1 and L2 prompts**

In `packages/core/src/review/reviewer-prompt.ts` (the L2 Fresh reviewer prompt), inside the existing instructions section:

1. Find the JSON response example (around line 70):

```typescript
  "factual_risks": ["claims not backed by evidence"],
  "missing_evidence": ["files or topics that should be cited"],
```

Add:

```typescript
  "missing_coverage": ["mechanism ids not represented in the draft"],
```

2. Add a new numbered rule after the citation density rule (around line 64):

```
7. **Mechanism coverage (recall)**: You will receive a MECHANISMS_TO_VERIFY list
   (mechanism ids with description + requirement). For every mechanism:

   - requirement=must_cite: The draft must contain a [cite:...] marker that
     references the mechanism's citation target (and locator if given).
   - requirement=must_mention: The draft text must mention the target name
     or obvious keywords from the description.

   List any mechanism ids not covered in missing_coverage. If missing_coverage
   is non-empty, verdict MUST be "revise". Do not invent ids — only use the
   ones you were given.
```

3. Add the MECHANISMS_TO_VERIFY rendering to the user-prompt builder (still in reviewer-prompt.ts, around line 100 where `buildReviewUserPrompt` is):

```typescript
if (briefing.mechanisms_to_verify && briefing.mechanisms_to_verify.length > 0) {
  const mechBlock = briefing.mechanisms_to_verify
    .map((m) => `- [${m.id}] ${m.description} (requirement: ${m.coverageRequirement})`)
    .join("\n");
  sections.push(`**MECHANISMS_TO_VERIFY:**\n${mechBlock}`);
}
```

- [ ] **Step 3: Mirror the prompt change in the L1 prompt**

In `packages/core/src/review/l1-semantic-prompt.ts`:

1. Find the JSON response example (around line 33) and add `"missing_coverage": []` to the example.

2. Add a rule to the L1 instructions (L1 doesn't use tools, so the check is text-only):

```
When a MECHANISMS_TO_VERIFY block is present, scan the draft for each
mechanism. For must_cite: look for [cite:...] containing the target.
For must_mention: look for the target string or keywords of the description.
List missing ids in missing_coverage. Non-empty missing_coverage forces
verdict="revise".
```

3. Render the MECHANISMS_TO_VERIFY block in the L1 user-prompt builder similarly to Step 2's reviewer-prompt change.

- [ ] **Step 4: Parse `missing_coverage` in `reviewer.ts` (L2)**

In `packages/core/src/review/reviewer.ts`, around line 134 (the blockers parse) add missing_coverage parsing:

```typescript
    const missingCoverage = Array.isArray(data.missing_coverage)
      ? (data.missing_coverage as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
```

Then in the returned conclusion object (around line 192-210), include it:

```typescript
    return {
      success: true,
      conclusion: {
        verdict,
        blockers,
        factual_risks: Array.isArray(data.factual_risks) ? (data.factual_risks as string[]) : [],
        missing_evidence: Array.isArray(data.missing_evidence) ? (data.missing_evidence as string[]) : [],
        scope_violations: Array.isArray(data.scope_violations) ? (data.scope_violations as string[]) : [],
        missing_coverage: missingCoverage,
        suggested_revisions: Array.isArray(data.suggested_revisions) ? (data.suggested_revisions as string[]) : [],
        verified_citations: verified.length > 0 ? verified : undefined,
      },
    };
```

Also, when promoting blocker cases (the `hasVerificationFailure` section around line 186), augment blockers from missing_coverage if non-empty and the flag isn't in the blocker list yet:

```typescript
    // Promote any missing_coverage entries into blockers (visible to pipeline + revision prompt)
    for (const id of missingCoverage) {
      const marker = `[coverage:${id}]`;
      if (!blockers.some((b) => b.includes(marker))) {
        blockers.push(`Mechanism ${marker} not covered in draft`);
      }
    }
    const forcedVerdict =
      missingCoverage.length > 0 ? "revise" : verdict;
```

And use `forcedVerdict` where `verdict` was returned.

- [ ] **Step 5: Parse `missing_coverage` in L1 (`l1-semantic-reviewer.ts`)**

In `packages/core/src/review/l1-semantic-reviewer.ts`, extend the `parseOutput` body (line 80-112). Add missing_coverage parsing + promotion into blockers and adjust verdict, following the same pattern as the L2 fix. For the empty-JSON branch (line 83-94), set `missing_coverage: []`.

```typescript
    const missingCoverage = Array.isArray(data.missing_coverage)
      ? (data.missing_coverage as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    const blockersAug = [...blockers];
    for (const id of missingCoverage) {
      const marker = `[coverage:${id}]`;
      if (!blockersAug.some((b) => b.includes(marker))) {
        blockersAug.push(`Mechanism ${marker} not covered in draft`);
      }
    }
    const forcedVerdict =
      blockersAug.length > 0 || missingCoverage.length > 0 || data.verdict === "revise"
        ? "revise"
        : "pass";

    return {
      success: true,
      conclusion: {
        verdict: forcedVerdict,
        blockers: blockersAug,
        factual_risks: Array.isArray(data.factual_risks) ? (data.factual_risks as string[]) : [],
        missing_evidence: Array.isArray(data.missing_evidence) ? (data.missing_evidence as string[]) : [],
        scope_violations: Array.isArray(data.scope_violations) ? (data.scope_violations as string[]) : [],
        missing_coverage: missingCoverage,
        suggested_revisions: Array.isArray(data.suggested_revisions) ? (data.suggested_revisions as string[]) : [],
      },
    };
```

Mirror the empty-JSON branch too (populate `missing_coverage: []`).

- [ ] **Step 6: Write focused tests**

Append to the existing `packages/core/src/review/__tests__/reviewer.test.ts` (or the existing test file for L2; create if missing) a test:

```typescript
  it("promotes missing_coverage to blockers and forces verdict=revise", () => {
    const reviewer = new FreshReviewer({ /* minimal ctor */ } as never);
    // call internal parseOutput with JSON containing missing_coverage: ["file:a.ts"]
    // expect: verdict=revise, blockers includes "Mechanism [coverage:file:a.ts] not covered in draft", missing_coverage === ["file:a.ts"]
  });
```

For the L1 reviewer, append to `l1-semantic-reviewer.test.ts` (or similar existing):

```typescript
  it("L1 parseOutput extracts missing_coverage and promotes to blockers", () => {
    // similar structure
  });
```

Implement minimally — access `parseOutput` if private via a test harness or re-export; pattern mirrors existing tests in each file.

- [ ] **Step 7: Run tests**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- reviewer l1-semantic-reviewer`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/review/reviewer-prompt.ts packages/core/src/review/reviewer.ts packages/core/src/review/l1-semantic-prompt.ts packages/core/src/review/l1-semantic-reviewer.ts packages/core/src/types/review.ts packages/core/src/review/__tests__/
git commit -m "$(cat <<'EOF'
feat(review): parse missing_coverage + promote to blockers

L1 and L2 reviewers now accept a MECHANISMS_TO_VERIFY briefing block.
parseOutput defensively extracts missing_coverage: string[]; any entry
is promoted to a "[coverage:<id>] not covered" blocker, and verdict is
forced to "revise". Empty/missing field defaults to [].

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `VerificationLadder` merges `missing_coverage`

**Files:**
- Modify: `packages/core/src/review/verification-ladder.ts`
- Modify: `packages/core/src/review/__tests__/verification-ladder.test.ts`

- [ ] **Step 1: Write failing test**

Append to `packages/core/src/review/__tests__/verification-ladder.test.ts`:

```typescript
  it("merges missing_coverage from L1 and L2 with dedup", () => {
    // Use the existing L1+L2 mock helpers in this file
    // Set L1 conclusion.missing_coverage = ["a", "b"]
    // Set L2 conclusion.missing_coverage = ["b", "c"]
    // Expect result.conclusion.missing_coverage sorted-dedup: ["a", "b", "c"]
  });

  it("propagates missing_coverage from L2-only when L1 short-circuits as pass", () => {
    // L0 pass, L1 pass (no coverage flagged), L2 flags ["x"]
    // Expect result.conclusion.missing_coverage = ["x"]
  });
```

Fill in test bodies following the existing patterns in that file.

- [ ] **Step 2: Run tests, confirm FAIL**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- verification-ladder`
Expected: FAIL — `missing_coverage` not present on merged conclusion.

- [ ] **Step 3: Add merge in `verification-ladder.ts`**

Around line 164-198 (the L2 merge block), add:

```typescript
    const mergedMissingCoverage = dedup([
      ...(l1Conclusion.missing_coverage ?? []),
      ...(l2Conclusion.missing_coverage ?? []),
    ]);
```

And include `missing_coverage: mergedMissingCoverage` in the returned conclusion object.

For the L1-only path (short-circuit after L1, around line 130-150), ensure the returned conclusion forwards `l1Conclusion.missing_coverage` (it's already spread through `...l1Conclusion` if that's how the merge is done — verify by reading the code).

- [ ] **Step 4: Run tests, confirm PASS**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- verification-ladder`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/review/verification-ladder.ts packages/core/src/review/__tests__/verification-ladder.test.ts
git commit -m "$(cat <<'EOF'
feat(ladder): merge missing_coverage across L1 + L2 conclusions

Same dedup pattern as factual_risks / missing_evidence. Short-circuit
paths also forward missing_coverage from the reached level.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Drafter + Pipeline Integration

### Task 8: `PageDrafter` injects `MECHANISMS TO COVER` into author context

**Files:**
- Modify: `packages/core/src/generation/page-drafter.ts`
- Modify: `packages/core/src/generation/page-drafter-prompt.ts`

- [ ] **Step 1: Add mechanisms to `MainAuthorContext`**

In `packages/core/src/types/agent.ts`, extend `MainAuthorContext` (around line 44):

```typescript
  /** When coverageEnforcement != "off", the list of mechanisms the drafter
   *  should consciously cover. Mirrors the outline's covers_mechanisms but
   *  with full descriptions so the drafter doesn't need to re-read ledger. */
  mechanisms?: import("../generation/mechanism-list.js").Mechanism[];
  /** Mechanism ids the outline planner declared out-of-scope; drafter
   *  should not expand them on this page. */
  mechanisms_out_of_scope?: string[];
```

- [ ] **Step 2: Render mechanisms in `buildPageDraftUserPrompt`**

In `packages/core/src/generation/page-drafter-prompt.ts`, find the function that renders user prompt sections (`buildPageDraftUserPrompt` or similar). Add a section:

```typescript
if (ctx.mechanisms && ctx.mechanisms.length > 0) {
  const mechBlock = ctx.mechanisms
    .map((m) => `- [${m.id}] ${m.description} (requirement: ${m.coverageRequirement})`)
    .join("\n");
  const outOfScopeNote = (ctx.mechanisms_out_of_scope ?? []).length > 0
    ? `\n\nOut of scope for this page (do NOT expand):\n${ctx.mechanisms_out_of_scope!.map((id) => `- ${id}`).join("\n")}`
    : "";
  sections.push(`## MECHANISMS TO COVER
${mechBlock}${outOfScopeNote}

For each mechanism:
- must_cite: include a \`[cite:...]\` marker referencing its citation target in the relevant section.
- must_mention: include the target name or description keywords somewhere in the body.
`);
}
```

(Adapt `sections.push` to however the current builder assembles the prompt.)

- [ ] **Step 3: Pass mechanisms through `PageDrafter.draft`**

`PageDrafter.draft` takes a `MainAuthorContext`. No signature change — the pipeline will just populate `mechanisms` and `mechanisms_out_of_scope` fields when building the context.

No code change in `page-drafter.ts` itself; the prompt assembler already reads from `MainAuthorContext`.

- [ ] **Step 4: Run tests (drafter suite)**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- page-drafter`
Expected: PASS (existing tests still green; new coverage-specific test added in Phase E).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types/agent.ts packages/core/src/generation/page-drafter-prompt.ts
git commit -m "$(cat <<'EOF'
feat(drafter): render MECHANISMS TO COVER block in author context

Drafter receives the mechanism list + out-of-scope ids; the prompt body
lists each with its coverage requirement. No signature changes — fields
are optional on MainAuthorContext.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Pipeline derives mechanisms and passes to outline + drafter + reviewer

**Files:**
- Modify: `packages/core/src/generation/generation-pipeline.ts`

- [ ] **Step 1: Import and add mechanism derivation site**

At the top of `packages/core/src/generation/generation-pipeline.ts`, add:

```typescript
import { deriveMechanismList, type Mechanism } from "./mechanism-list.js";
```

Inside `runPageWorkflow`, after `evidenceResult` is available and before the outline planner is called, add:

```typescript
    // Derive mechanism list from the current evidence ledger. Empty when
    // coverageEnforcement is "off" or when the ledger has no notes.
    let mechanisms: Mechanism[] = [];
    if (qp.coverageEnforcement !== "off" && evidenceResult) {
      mechanisms = deriveMechanismList(evidenceResult.ledger, page.covered_files);
    }
```

- [ ] **Step 2: Pass mechanisms to OutlinePlanner**

Find the `outlinePlanner.planWithMetrics({...})` call. Add `mechanisms` to the argument object:

```typescript
const outlineOutput = await outlinePlanner.planWithMetrics({
  pageTitle: page.title,
  pageRationale: page.rationale,
  coveredFiles: page.covered_files,
  language: this.config.language,
  ledger: evidenceResult.ledger,
  findings: evidenceResult.findings,
  mechanisms,
});
```

- [ ] **Step 3: Compute out-of-scope ids from outline**

Right after the outline call:

```typescript
    const outOfScopeIds = (outlineOutput.outline.out_of_scope_mechanisms ?? []).map((x) => x.id);
    const mechanismsForDrafter = mechanisms.filter((m) => !outOfScopeIds.includes(m.id));
    const mechanismsForReviewer = mechanismsForDrafter; // same filter for reviewer
```

- [ ] **Step 4: Populate `MainAuthorContext` fields for drafter**

Find where `authorContext` (or equivalent `MainAuthorContext`) is assembled. Add:

```typescript
const authorContext: MainAuthorContext = {
  // ...existing fields...
  ...(mechanismsForDrafter.length > 0 ? { mechanisms: mechanismsForDrafter } : {}),
  ...(outOfScopeIds.length > 0 ? { mechanisms_out_of_scope: outOfScopeIds } : {}),
};
```

- [ ] **Step 5: Populate `ReviewBriefing` for reviewer**

Find where the `ReviewBriefing` is assembled. Add:

```typescript
const briefing: ReviewBriefing = {
  // ...existing fields...
  ...(mechanismsForReviewer.length > 0 ? { mechanisms_to_verify: mechanismsForReviewer } : {}),
};
```

- [ ] **Step 6: Typecheck + run full suite**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test`
Expected: existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/generation/generation-pipeline.ts
git commit -m "$(cat <<'EOF'
feat(pipeline): derive mechanism list and thread through outline/drafter/reviewer

Pipeline calls deriveMechanismList after evidence completes (skipped when
coverageEnforcement is "off"). Mechanisms are passed to OutlinePlanner
(enforcing allocation), then filtered by out_of_scope ids before being
given to the drafter (authorContext.mechanisms) and reviewer
(briefing.mechanisms_to_verify).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Pipeline routes `missing_coverage` as revision trigger (not evidence re-run)

**Files:**
- Modify: `packages/core/src/generation/generation-pipeline.ts`

- [ ] **Step 1: Locate the revision-decision block**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && grep -n "missing_evidence" packages/core/src/generation/generation-pipeline.ts | head`

- [ ] **Step 2: Split evidence-re-run decision from revision decision**

Replace the current revision-trigger region (currently checks only `missing_evidence`, `factual_risks`, `scope_violations`) with:

```typescript
        const hasEvidenceIssues =
          (reviewResult?.conclusion?.missing_evidence?.length ?? 0) > 0 ||
          (reviewResult?.conclusion?.factual_risks?.length ?? 0) > 0 ||
          (reviewResult?.conclusion?.scope_violations?.length ?? 0) > 0;

        const hasCoverageGap =
          qp.coverageEnforcement === "strict" &&
          (reviewResult?.conclusion?.missing_coverage?.length ?? 0) > 0;

        const needsRevision = hasEvidenceIssues || hasCoverageGap;
```

Then update the `shouldCollectEvidence` condition (cap was introduced earlier) to **only** consume evidence-attempt budget when `hasEvidenceIssues` is true:

```typescript
        const shouldCollectEvidence =
          coordinator !== null &&
          evidenceCollectionCount < qp.maxEvidenceAttempts &&
          ((attempt === 0 && !evidenceResult) ||
           (attempt > 0 && hasEvidenceIssues));
```

(Coverage gaps do NOT add to `evidenceCollectionCount` and do NOT re-run evidence.)

And replace the existing branch that reads:

```typescript
if (missingEvidence.length > 0 || factualRisks.length > 0 || scopeViolations.length > 0) { ... }
```

with `if (needsRevision) { ... }`.

- [ ] **Step 3: Persist `pageMeta.coverageBlockers` when revisions are exhausted**

Near the code that constructs `pageMeta` on the final validated page (search for `reviewStatus` / `reviewDigest` assembly), add:

```typescript
      const finalMissingCoverage =
        finalReview?.conclusion?.missing_coverage ?? [];
      pageMeta.coverageBlockers = finalMissingCoverage;
```

You may need to extend the `PageMeta` type (in whichever file it lives — usually `packages/core/src/types/generation.ts`). Add:

```typescript
  /** Mechanism ids still uncovered when the page was finalized. Populated
   *  only when coverageEnforcement is on and revisions were exhausted. */
  coverageBlockers?: string[];
```

- [ ] **Step 4: Typecheck + run tests**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test`
Expected: existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/generation/generation-pipeline.ts packages/core/src/types/generation.ts
git commit -m "$(cat <<'EOF'
feat(pipeline): route missing_coverage as revision-only trigger

needsRevision = hasEvidenceIssues || (strict && missing_coverage != []).
Coverage gaps never increment evidenceCollectionCount; only re-draft
happens. When revisions are exhausted, pageMeta.coverageBlockers records
the final unresolved list for human review.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Throughput metrics — `coverage` + `coverageAudit`

**Files:**
- Modify: `packages/core/src/generation/throughput-metrics.ts`
- Modify: `packages/core/src/generation/generation-pipeline.ts`
- Modify: `packages/core/src/generation/__tests__/throughput-metrics.test.ts` (if exists; else add)

- [ ] **Step 1: Extend types**

In `packages/core/src/generation/throughput-metrics.ts`, add to `PageThroughputRecord`:

```typescript
  /** Mechanism coverage audit for this page. Undefined when
   *  coverageEnforcement was "off" at generation time. */
  coverage?: {
    totalMechanisms: number;
    outOfScopeMechanisms: number;
    unresolvedMissingCoverage: number;
    coverageDrivenRevisions: number;
  };
```

And to `ThroughputReport`:

```typescript
  /** Job-wide mechanism coverage summary. Undefined when no page used
   *  coverage enforcement. */
  coverageAudit?: {
    totalMechanismsJob: number;
    unresolvedJob: number;
    pagesWithCoverageGap: string[];
  };
```

- [ ] **Step 2: Update `ThroughputReportBuilder.finish`**

In the same file, inside `finish()` (after totals are computed), fold in the audit:

```typescript
    let coverageAudit: ThroughputReport["coverageAudit"] | undefined;
    const pagesWithCoverage = this.pageRecords.filter((p) => p.coverage != null);
    if (pagesWithCoverage.length > 0) {
      let totalMechanismsJob = 0;
      let unresolvedJob = 0;
      const pagesWithGap: string[] = [];
      for (const p of pagesWithCoverage) {
        const c = p.coverage!;
        totalMechanismsJob += c.totalMechanisms;
        unresolvedJob += c.unresolvedMissingCoverage;
        if (c.unresolvedMissingCoverage > 0) pagesWithGap.push(p.pageSlug);
      }
      coverageAudit = {
        totalMechanismsJob,
        unresolvedJob,
        pagesWithCoverageGap: pagesWithGap,
      };
    }

    return {
      // ...existing fields...
      ...(coverageAudit ? { coverageAudit } : {}),
    };
```

- [ ] **Step 3: Populate per-page `coverage` in pipeline**

In `generation-pipeline.ts`, where `PageThroughputRecord` is assembled for a successful page (search for `pageMetrics: PageThroughputRecord`), add:

```typescript
  ...(qp.coverageEnforcement !== "off"
    ? {
        coverage: {
          totalMechanisms: mechanisms.length,
          outOfScopeMechanisms: outOfScopeIds.length,
          unresolvedMissingCoverage:
            finalReview?.conclusion?.missing_coverage?.length ?? 0,
          coverageDrivenRevisions, // track via counter
        },
      }
    : {}),
```

Earlier in the revision loop, add a counter:

```typescript
let coverageDrivenRevisions = 0;
// ... inside the revision loop, after needsRevision is computed:
if (needsRevision && hasCoverageGap && !hasEvidenceIssues) {
  coverageDrivenRevisions += 1;
}
```

- [ ] **Step 4: Write test for the audit aggregation**

Append to `throughput-metrics.test.ts` (or the sibling `throughput-prefetch-metrics.test.ts` pattern file):

```typescript
  it("aggregates coverage audit across pages", () => {
    const builder = new ThroughputReportBuilder();
    builder.setCatalog(zeroPhaseMetric());
    // Page 1: 5 mechanisms, 0 unresolved
    builder.addPage(makePageRecord({
      pageSlug: "p1",
      coverage: {
        totalMechanisms: 5,
        outOfScopeMechanisms: 1,
        unresolvedMissingCoverage: 0,
        coverageDrivenRevisions: 0,
      },
    }));
    // Page 2: 3 mechanisms, 2 unresolved
    builder.addPage(makePageRecord({
      pageSlug: "p2",
      coverage: {
        totalMechanisms: 3,
        outOfScopeMechanisms: 0,
        unresolvedMissingCoverage: 2,
        coverageDrivenRevisions: 3,
      },
    }));

    const report = builder.finish({ totalLatencyMs: 1000 });
    expect(report.coverageAudit).toBeDefined();
    expect(report.coverageAudit!.totalMechanismsJob).toBe(8);
    expect(report.coverageAudit!.unresolvedJob).toBe(2);
    expect(report.coverageAudit!.pagesWithCoverageGap).toEqual(["p2"]);
  });

  it("omits coverageAudit when no page used coverage enforcement", () => {
    const builder = new ThroughputReportBuilder();
    builder.setCatalog(zeroPhaseMetric());
    builder.addPage(makePageRecord({ pageSlug: "p1" })); // no coverage field
    const report = builder.finish({ totalLatencyMs: 1000 });
    expect(report.coverageAudit).toBeUndefined();
  });
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/generation/throughput-metrics.ts packages/core/src/generation/generation-pipeline.ts packages/core/src/generation/__tests__/throughput-metrics.test.ts
git commit -m "$(cat <<'EOF'
feat(metrics): add coverage per-page record + job-level coverageAudit

Populated only when coverageEnforcement != "off". Per-page tracks total,
out_of_scope, unresolved, and coverageDrivenRevisions. Report-level
aggregates sum + pagesWithCoverageGap list.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Prefetcher derives mechanisms (consistency with main path)

**Files:**
- Modify: `packages/core/src/generation/page-prefetcher.ts`

- [ ] **Step 1: Inside `startPrefetch` add mechanism derivation after evidence**

Find the section inside `page-prefetcher.ts` where evidence is collected and outline is planned. After the evidence result is obtained but before calling `outlinePlanner.planWithMetrics`, add:

```typescript
    const mechanisms =
      ctx.qualityProfile?.coverageEnforcement && ctx.qualityProfile.coverageEnforcement !== "off"
        ? deriveMechanismList(evidenceResult.ledger, page.covered_files)
        : [];
```

Import `deriveMechanismList` at the top. Pass `mechanisms` when calling `outlinePlanner.planWithMetrics`.

The prefetcher doesn't yet receive `qualityProfile`. Extend `PrefetchContext` to include:

```typescript
export type PrefetchContext = {
  // ...existing...
  qualityProfile?: { coverageEnforcement: "off" | "warn" | "strict" };
};
```

And in the main pipeline, when calling `startPrefetch`, include `qualityProfile: qp`.

- [ ] **Step 2: Build + typecheck**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core typecheck`
Expected: No errors.

- [ ] **Step 3: Run tests**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- page-prefetcher`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/generation/page-prefetcher.ts packages/core/src/generation/generation-pipeline.ts
git commit -m "$(cat <<'EOF'
feat(prefetch): derive mechanisms when coverageEnforcement != "off"

Keeps prefetched outline consistent with the main-path outline (same
mechanism inputs). When coverage is off, prefetch is unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase E — CLI + Integration Testing

### Task 13: CLI `--coverage-enforcement` flag

**Files:**
- Modify: `packages/cli/src/cli.tsx`
- Modify: `packages/cli/src/commands/generate.tsx`

- [ ] **Step 1: Add flag on `generate` subcommand**

In `packages/cli/src/cli.tsx`, find the `generate` subcommand registration (look for `.command("generate")`). Add:

```typescript
  .option(
    "--coverage-enforcement <mode>",
    "Mechanism coverage enforcement: off, warn (observe only), or strict (triggers re-draft on gaps). Overrides the preset default.",
    (value) => {
      if (!["off", "warn", "strict"].includes(value)) {
        throw new Error(`--coverage-enforcement must be one of: off, warn, strict (got "${value}")`);
      }
      return value as "off" | "warn" | "strict";
    },
  )
```

- [ ] **Step 2: Pass flag into `runGenerate` options**

Still in `cli.tsx`, in the action handler, pass `coverageEnforcement`:

```typescript
    .action(async (opts) => {
      if (opts.debug) process.env.REPOREAD_DEBUG = "1";
      await runGenerate({
        dir: opts.dir,
        name: opts.name,
        resume: opts.resume,
        incremental: opts.incremental,
        pageConcurrency: opts.pageConcurrency,
        coverageEnforcement: opts.coverageEnforcement,
      });
    });
```

- [ ] **Step 3: Accept in `GenerateOptions`**

In `packages/cli/src/commands/generate.tsx`, extend:

```typescript
export interface GenerateOptions {
  // ...existing...
  coverageEnforcement?: "off" | "warn" | "strict";
}
```

Inside `runGenerate`, override the resolved quality profile when the flag is set:

```typescript
  if (options.coverageEnforcement != null) {
    resolvedConfig.qualityProfile = {
      ...resolvedConfig.qualityProfile,
      coverageEnforcement: options.coverageEnforcement,
    };
  }
```

Update the config-resolved log line to include the coverage mode:

```typescript
  console.log(
    `Config resolved: preset=${resolvedConfig.preset} pageConcurrency=${resolvedConfig.qualityProfile.pageConcurrency} coverageEnforcement=${resolvedConfig.qualityProfile.coverageEnforcement}`,
  );
```

- [ ] **Step 4: Build + typecheck**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core build && pnpm --filter @reporead/cli typecheck`
Expected: No errors.

- [ ] **Step 5: Run CLI tests**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/cli test`
Expected: PASS.

- [ ] **Step 6: Verify flag appears in help**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/cli build && node packages/cli/dist/index.js generate --help 2>&1 | grep coverage-enforcement`
Expected: Output includes `--coverage-enforcement <mode>` line.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/cli.tsx packages/cli/src/commands/generate.tsx
git commit -m "$(cat <<'EOF'
feat(cli): --coverage-enforcement <off|warn|strict> flag

Overrides qp.coverageEnforcement for a single run. Validated against the
three allowed values at parse time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: End-to-end integration test (mock LLM, full pipeline)

**Files:**
- Create: `packages/core/src/generation/__tests__/coverage-integration.test.ts`

- [ ] **Step 1: Write the integration test skeleton reusing existing pipeline mock pattern**

Read `packages/core/src/generation/__tests__/generation-pipeline.test.ts` for setup helpers:

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && head -160 packages/core/src/generation/__tests__/generation-pipeline.test.ts`

Create `packages/core/src/generation/__tests__/coverage-integration.test.ts` using the same mock `ai` pattern:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { GenerationPipeline } from "../generation-pipeline.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import { JobStateManager } from "../job-state.js";
import type { ResolvedConfig } from "../../types/config.js";
import { getQualityProfile } from "../../config/quality-profile.js";

// Mock 'ai' following the same pattern as generation-pipeline.test.ts
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

// Force L1 review so reviewer actually runs
vi.mock("../../review/verification-level.js", () => ({
  selectVerificationLevel: () => "L1" as const,
}));

function makeConfig(overrides: Partial<ReturnType<typeof getQualityProfile>> = {}): ResolvedConfig {
  return {
    projectSlug: "proj",
    repoRoot: "/tmp/repo",
    preset: "budget",
    language: "zh",
    roles: {
      catalog: { role: "catalog", primaryModel: "m1", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
      outline: { role: "outline", primaryModel: "m1", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
      drafter: { role: "drafter", primaryModel: "m1", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
      worker: { role: "worker", primaryModel: "m1", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
      reviewer: { role: "reviewer", primaryModel: "m1", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
    },
    providers: [],
    retrieval: { maxParallelReadsPerPage: 5, maxReadWindowLines: 500, allowControlledBash: true },
    qualityProfile: { ...getQualityProfile("budget"), ...overrides },
  };
}

const mockResponse = (text: string) => ({
  text,
  usage: { inputTokens: 100, outputTokens: 50 },
}) as never;

describe("coverage enforcement integration", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let jobManager: JobStateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-coverage-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    jobManager = new JobStateManager(storage);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("off: derives nothing, behavior equivalent to legacy", async () => {
    const config = makeConfig({ coverageEnforcement: "off" });
    // Wire up minimum mocks for a 2-page happy path (see generation-pipeline.test.ts pattern)
    // Pipeline should finish with no throughput.coverageAudit field.
    // Assertion: JSON.parse(throughput.json).coverageAudit === undefined
  });

  it("warn: reviewer returns missing_coverage but pipeline does NOT trigger revision", async () => {
    // Arrange: mock reviewer to return missing_coverage: ["file:ignored.ts"]
    // Assert: page.validated fires without extra revision; final pageMeta.coverageBlockers = ["file:ignored.ts"]
    // Assert: throughput.coverageAudit.unresolvedJob >= 1
  });

  it("strict: missing_coverage triggers re-draft without re-evidence", async () => {
    // Arrange: 1st-draft-1st-review missing_coverage = ["file:m2"]; 2nd draft covers it
    // Assert: evidenceCollectionCount == 1 (never increased because no missing_evidence)
    // Assert: coverageDrivenRevisions == 1, final unresolvedMissingCoverage == 0
  });

  it("strict: revision cap exhausted with missing_coverage → page published with coverageBlockers", async () => {
    // Arrange: reviewer always returns missing_coverage = ["file:m3"]
    // Assert: page still reaches page.validated (L1 fallback)
    // Assert: pageMeta.coverageBlockers == ["file:m3"]
    // Assert: throughput.coverageAudit.pagesWithCoverageGap includes the slug
  });
});
```

**Note:** The four test bodies require full mock orchestration. Reuse the mock-routing pattern from `evidence-replanning.test.ts` (identify reviewer calls via system prompt match). The test file above is a skeleton — flesh out each body by mirroring the existing test file's structure.

- [ ] **Step 2: Implement test bodies**

For each `it(...)` block, use `mockGenerateText.mockImplementation((params) => { ... })` that:

1. Returns a 2-page catalog on the first call.
2. Returns worker/outline/draft/reviewer responses based on system-prompt matching.
3. For the revise-revise-pass scenario, a mutable counter controls which reviewer response is returned.

Follow the exact pattern in `packages/core/src/generation/__tests__/evidence-replanning.test.ts` (the `stops re-collecting evidence` test). Adapt so that reviewer responses include `missing_coverage` for specific scenarios.

- [ ] **Step 3: Run tests**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- coverage-integration`
Expected: PASS (4 tests).

- [ ] **Step 4: Run full suite**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/generation/__tests__/coverage-integration.test.ts
git commit -m "$(cat <<'EOF'
test(coverage): end-to-end integration for off/warn/strict modes

Four scenarios: off = legacy no-op, warn = audits without revising,
strict = re-draft without re-evidence, strict + cap-exhausted = page
published with coverageBlockers recorded.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: E2E smoke test on repo-read itself (manual verification)

**Files:** no code — observation only.

- [ ] **Step 1: Full build**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm build`
Expected: all packages build cleanly.

- [ ] **Step 2: Warm run on repo-read in warn mode (phase 1)**

```bash
cd /Users/jyxc-dz-0100318/open_source/repo_read
node packages/cli/dist/index.js generate --name repo-read --page-concurrency 3 --coverage-enforcement warn 2>&1 | tee /tmp/coverage-warn.log
```

Record the job id. After completion, read `throughput.json`:

Run: `python3 -c "import json; d=json.load(open('.reporead/projects/repo-read/jobs/<JOB>/throughput.json')); print(d.get('coverageAudit'))"`
Expected: `coverageAudit` present; `unresolvedJob > 0` (at least one page reports missing_coverage, because Publisher / `maxEvidenceAttempts` should still be surfaced).

- [ ] **Step 3: Spot check**

Grep new job's pages/*.meta.json for `coverageBlockers`:

Run: `find .reporead/projects/repo-read/versions/*/pages/*.meta.json -newer /tmp/coverage-warn.log | xargs grep -l coverageBlockers | head -5`
Expected: at least one page with non-empty coverageBlockers.

- [ ] **Step 4: Strict run (phase 2)**

```bash
cd /Users/jyxc-dz-0100318/open_source/repo_read
node packages/cli/dist/index.js generate --name repo-read --page-concurrency 3 --coverage-enforcement strict 2>&1 | tee /tmp/coverage-strict.log
```

After completion, the new job's `throughput.json.coverageAudit.unresolvedJob` should be much lower than the warn run (ideally ≈ 0).

- [ ] **Step 5: Wall-time comparison**

Compare the strict run's wall time vs the previous pc=3 baseline (3.58h on 16 pages). Expect +10-20%. If the regression is > 30%, investigate which pages are thrashing revisions.

- [ ] **Step 6: Page content spot check**

Spot check that the generated pages for review/validation and evidence topics now mention Publisher and `maxEvidenceAttempts`. This validates the feature end-to-end.

- [ ] **Step 7: Record results**

Append the phase 1 (warn) and phase 2 (strict) outcomes to a new notes file (optional):

```bash
cat > docs/superpowers/plans/2026-04-17-coverage-rollout-notes.md <<'EOF'
# Mechanism Coverage Rollout Notes

## Phase 1 (warn) on repo-read
- wall time: <x>h
- coverageAudit.unresolvedJob: <n>
- pagesWithCoverageGap: <list>

## Phase 2 (strict) on repo-read
- wall time: <y>h (Δ vs baseline: +<p>%)
- coverageAudit.unresolvedJob: <n>
- pages where Publisher / maxEvidenceAttempts now appear: <slugs>
EOF
git add docs/superpowers/plans/2026-04-17-coverage-rollout-notes.md
git commit -m "docs(coverage): record phase 1/2 rollout results"
```

If results look good, proceed with adopting `strict` as the quality-preset default (separate small commit).

---

## Self-Review Checklist

**1. Spec coverage:**

| Spec section | Implementing task |
|---|---|
| §2 data flow | Tasks 2, 5, 6, 7, 9, 10 |
| §3.1 `Mechanism` type + `deriveMechanismList` | Task 2 |
| §3.2 outline schema + prompt + retry + fallback | Tasks 3, 5 |
| §3.3 drafter authorContext MECHANISMS TO COVER | Task 8 |
| §3.4 reviewer prompt + parse + blocker promotion | Tasks 4, 6 |
| §3.5 pipeline routing (re-draft only, not re-evidence) | Tasks 9, 10 |
| §3.6 `QualityProfile.coverageEnforcement` | Task 1 |
| §3.7 CLI flag | Task 13 |
| §3.8 metrics (`coverage` per page + `coverageAudit` job-wide) | Task 11 |
| §4 testing strategy | Tasks 1-14 (each has tests); integration is Task 14 |
| §5 phase 1 warn → phase 2 strict rollout | Task 15 |
| §6 rollback strategy | Implicit: `coverageEnforcement="off"` preserved in defaults |
| §9 file changes | All tasks touch the listed files |

**2. Placeholder scan:** No TBD/TODO. Task 6 Steps 6 and Task 14 Steps 1-2 explicitly instruct the engineer to adapt existing mock patterns — the patterns themselves are fully defined in existing test files referenced by command.

**3. Type consistency:**
- `Mechanism` defined in Task 2, imported in Tasks 5, 6, 8, 9.
- `coverageEnforcement: "off" | "warn" | "strict"` consistent in Tasks 1, 9, 10, 11, 12, 13.
- `missing_coverage: string[]` optional on `ReviewConclusion`, consistent in Tasks 4, 6, 7, 10, 11.
- `covers_mechanisms: string[]` + `out_of_scope_mechanisms` consistent on `PageOutline` in Tasks 3, 5.
- `coverageBlockers?: string[]` on `PageMeta` (Task 10) matches pageMeta persistence (Task 10) and e2e check (Task 15).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-17-mechanism-coverage-guarantee.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
