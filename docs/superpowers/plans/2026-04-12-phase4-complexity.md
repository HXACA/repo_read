# Phase 4: 页面复杂度评分 + 动态加码

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute a structural complexity score per page. Dynamically increase execution parameters for complex pages. Preset is the floor — only upward adjustments.

**Architecture:** New `PageComplexityScore` type computed from file count, directory spread, and cross-language signals. Pipeline adjusts `forkWorkers`, `drafterMaxSteps`, etc. based on score and runtime signals (reviewer feedback, truncation). Emit events for observability.

**Tech Stack:** TypeScript strict, Vitest, Node.js 22

**Depends on:** Phase 1 complete (workerMaxSteps in QualityProfile). Phases 2/3 enhance the effect but are not blocking.

---

### Task 1: PageComplexityScore type + computation

**Files:**
- Create: `packages/core/src/generation/complexity-scorer.ts`
- Create: `packages/core/src/generation/__tests__/complexity-scorer.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { computeComplexity } from "../complexity-scorer.js";

describe("computeComplexity", () => {
  it("scores a simple page low", () => {
    const score = computeComplexity({
      coveredFiles: ["README.md"],
    });
    expect(score.fileCount).toBe(1);
    expect(score.dirSpread).toBe(1);
    expect(score.crossLanguage).toBe(false);
    expect(score.score).toBeLessThan(5);
  });

  it("scores a complex page high", () => {
    const score = computeComplexity({
      coveredFiles: [
        "src/api/routes.ts",
        "src/api/middleware.ts",
        "src/services/auth.ts",
        "src/models/user.py",
        "lib/utils/helpers.js",
        "config/settings.yaml",
        "tests/api/routes.test.ts",
        "docs/api.md",
      ],
    });
    expect(score.fileCount).toBe(8);
    expect(score.dirSpread).toBeGreaterThan(3);
    expect(score.crossLanguage).toBe(true);
    expect(score.score).toBeGreaterThan(10);
  });

  it("detects cross-language from extensions", () => {
    const score = computeComplexity({
      coveredFiles: ["main.go", "handler.go", "test.py"],
    });
    expect(score.crossLanguage).toBe(true);
  });
});
```

- [ ] **Step 2: Implement scorer**

```typescript
// packages/core/src/generation/complexity-scorer.ts
import * as path from "node:path";

export type PageComplexityScore = {
  fileCount: number;
  dirSpread: number;
  crossLanguage: boolean;
  score: number;
};

const LANG_GROUPS: Record<string, string> = {
  ".ts": "js", ".tsx": "js", ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js",
  ".py": "python", ".pyx": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java", ".kt": "kotlin",
  ".rb": "ruby",
  ".c": "c", ".cpp": "c", ".h": "c", ".hpp": "c",
  ".swift": "swift",
};

export function computeComplexity(input: { coveredFiles: string[] }): PageComplexityScore {
  const files = input.coveredFiles;
  const fileCount = files.length;

  // Directory spread: count unique parent directories
  const dirs = new Set(files.map((f) => path.dirname(f)));
  const dirSpread = dirs.size;

  // Cross-language: check if files span multiple language groups
  const langs = new Set<string>();
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    const lang = LANG_GROUPS[ext];
    if (lang) langs.add(lang);
  }
  const crossLanguage = langs.size > 1;

  // Weighted score: files + dirs + language bonus
  const score = fileCount + dirSpread * 2 + (crossLanguage ? 5 : 0);

  return { fileCount, dirSpread, crossLanguage, score };
}
```

- [ ] **Step 3: Run tests + commit**

```bash
pnpm -w test -- --reporter=verbose packages/core/src/generation/__tests__/complexity-scorer.test.ts
pnpm -w test
git add packages/core/src/generation/complexity-scorer.ts \
       packages/core/src/generation/__tests__/complexity-scorer.test.ts
git commit -m "feat(complexity): PageComplexityScore from file count, dir spread, cross-language"
```

---

### Task 2: Dynamic parameter adjustment

**Files:**
- Create: `packages/core/src/generation/param-adjuster.ts`
- Create: `packages/core/src/generation/__tests__/param-adjuster.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { adjustParams } from "../param-adjuster.js";
import { getQualityProfile } from "../../config/quality-profile.js";

describe("adjustParams", () => {
  const base = getQualityProfile("quality");

  it("does not reduce any parameter below preset baseline", () => {
    const result = adjustParams(base, { score: 1, fileCount: 1, dirSpread: 1, crossLanguage: false });
    expect(result.forkWorkers).toBeGreaterThanOrEqual(base.forkWorkers);
    expect(result.drafterMaxSteps).toBeGreaterThanOrEqual(base.drafterMaxSteps);
  });

  it("increases parameters for high complexity", () => {
    const result = adjustParams(base, { score: 20, fileCount: 10, dirSpread: 6, crossLanguage: true });
    expect(result.forkWorkers).toBeGreaterThan(base.forkWorkers);
    expect(result.drafterMaxSteps).toBeGreaterThan(base.drafterMaxSteps);
  });

  it("increases reviewer verify for low citation density signal", () => {
    const result = adjustParams(base, { score: 5, fileCount: 3, dirSpread: 2, crossLanguage: false }, {
      lowCitationDensity: true,
    });
    expect(result.reviewerVerifyMinCitations).toBeGreaterThan(base.reviewerVerifyMinCitations);
  });

  it("increases maxOutputTokens on truncation signal", () => {
    const result = adjustParams(base, { score: 5, fileCount: 3, dirSpread: 2, crossLanguage: false }, {
      draftTruncated: true,
    });
    // maxOutputTokens isn't in QualityProfile, but the adjuster should return an override
    expect(result).toHaveProperty("maxOutputTokensBoost");
  });
});
```

- [ ] **Step 2: Implement adjuster**

```typescript
// packages/core/src/generation/param-adjuster.ts
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
```

- [ ] **Step 3: Run tests + commit**

```bash
pnpm -w test
git add packages/core/src/generation/param-adjuster.ts \
       packages/core/src/generation/__tests__/param-adjuster.test.ts
git commit -m "feat(params): dynamic parameter adjuster — preset floor + complexity/signal boosts"
```

---

### Task 3: Pipeline integrates complexity scoring + param adjustment

**Files:**
- Modify: `packages/core/src/generation/generation-pipeline.ts`
- Modify: `packages/core/src/generation/generation-events.ts`

- [ ] **Step 1: Compute complexity at page start**

At the beginning of each page iteration (after skip check), add:
```typescript
  import { computeComplexity } from "./complexity-scorer.js";
  import { adjustParams, type RuntimeSignals } from "./param-adjuster.js";

  const complexity = computeComplexity({ coveredFiles: page.covered_files });
  let pageParams = adjustParams(qp, complexity);
```

- [ ] **Step 2: Use pageParams instead of qp for page-level settings**

Replace uses of `qp.forkWorkers`, `qp.drafterMaxSteps`, etc. with `pageParams.forkWorkers`, `pageParams.drafterMaxSteps` within the page loop.

For the drafter, if `pageParams.maxOutputTokensBoost > 0`, add it to the default maxOutputTokens.

- [ ] **Step 3: Re-adjust on runtime signals during retry**

After a truncation or reviewer feedback, update signals and re-adjust:
```typescript
  if (draftResult.truncated) {
    pageParams = adjustParams(qp, complexity, { draftTruncated: true });
  }
  if (reviewResult?.conclusion) {
    pageParams = adjustParams(qp, complexity, {
      factualRisksCount: reviewResult.conclusion.factual_risks.length,
      missingEvidenceCount: reviewResult.conclusion.missing_evidence.length,
    });
  }
```

- [ ] **Step 4: Emit observability events**

Add new event types:
```typescript
  await emitter.emit("page.complexity_scored", page.slug, {
    score: complexity.score,
    fileCount: complexity.fileCount,
    dirSpread: complexity.dirSpread,
    crossLanguage: complexity.crossLanguage,
  });
```

When params are adjusted beyond baseline:
```typescript
  if (pageParams.forkWorkers > qp.forkWorkers) {
    await emitter.emit("page.params_adjusted", page.slug, {
      field: "forkWorkers", from: qp.forkWorkers, to: pageParams.forkWorkers, reason: "complexity",
    });
  }
```

- [ ] **Step 5: Run tests + rebuild + commit**

```bash
pnpm -w test
pnpm --filter @reporead/core build && pnpm --filter @reporead/cli build
git add packages/core/src/generation/generation-pipeline.ts \
       packages/core/src/generation/generation-events.ts
git commit -m "feat(pipeline): integrate complexity scoring + dynamic param adjustment per page"
```

---

## Verification

- Simple pages (1-3 files) use preset baseline parameters
- Complex pages (8+ files, cross-directory) get boosted parameters
- Truncation triggers maxOutputTokens boost on retry
- Reviewer factual_risks triggers forkWorkers boost on retry
- Debug events show complexity scores and parameter adjustments
- Total generation time decreases (simple pages finish faster with same quality)
- All tests pass
