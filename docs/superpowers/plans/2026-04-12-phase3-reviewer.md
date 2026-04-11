# Phase 3: Reviewer 改造 + 差分 Review

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reviewer reads draft from file via tools (real citation verification). Revision reviews are differential — only check previously flagged issues. Evidence re-collection is incremental.

**Architecture:** ReviewBriefing switches from `current_draft: string` to `draft_file: string`. Reviewer prompt instructs `read` tool usage. On revision, previous review result is passed and prompt focuses on flagged issues. Evidence coordinator accepts existing ledger and focus areas.

**Tech Stack:** TypeScript strict, Vitest, Node.js 22, Vercel AI SDK

**Depends on:** Phase 2 complete (files on disk, drafter reads via tools)

---

### Task 1: ReviewBriefing type change + reviewer prompt

**Files:**
- Modify: `packages/core/src/types/review.ts`
- Modify: `packages/core/src/review/reviewer-prompt.ts`
- Modify: `packages/core/src/review/reviewer.ts`

- [ ] **Step 1: Update ReviewBriefing type**

```typescript
export type ReviewBriefing = {
  page_title: string;
  section_position: string;
  current_page_plan: string;
  full_book_summary: string;
  draft_file: string;              // replaces current_draft
  covered_files: string[];
  published_summaries_file?: string;
  review_questions: string[];
  // Differential review fields
  previous_review?: ReviewConclusion;
  revision_diff_summary?: string;
};
```

- [ ] **Step 2: Update reviewer prompt for file-based reading**

In `reviewer-prompt.ts`, update `buildReviewerUserPrompt` to:
- Include `draft_file` path with instruction: "Use the `read` tool to read the draft at this path before reviewing"
- For each citation in the draft, instruct: "Use `read` to verify the citation against the source file"
- When `published_summaries_file` is provided: "Read the published index to check for cross-page duplication"

- [ ] **Step 3: Add differential review mode**

When `briefing.previous_review` is present, prepend to the user prompt:
```
## Differential Review (Revision Attempt)

The previous review found these issues:
- Blockers: [list]
- Factual risks: [list]
- Missing evidence: [list]

The author has revised the draft. Changes affect: [revision_diff_summary]

Focus your review on:
1. Check if each previously flagged issue is now resolved
2. Spot-check 1-2 unchanged sections for regression
3. Only report NEW issues not in the previous review
```

- [ ] **Step 4: Update reviewer.ts to pass tools**

Reviewer already has tools. Ensure `maxSteps` is increased (the prompt now requires reading files). Update default from 15 to 25 for quality preset.

In `quality-profile.ts`, change `reviewerMaxSteps`: quality=25, balanced=15 (unchanged for balanced/budget).

- [ ] **Step 5: Run tests + commit**

```bash
pnpm -w test
git add packages/core/src/types/review.ts \
       packages/core/src/review/reviewer-prompt.ts \
       packages/core/src/review/reviewer.ts \
       packages/core/src/config/quality-profile.ts
git commit -m "feat(reviewer): file-based draft reading + differential review mode"
```

---

### Task 2: Pipeline wires new ReviewBriefing

**Files:**
- Modify: `packages/core/src/generation/generation-pipeline.ts`

- [ ] **Step 1: Construct ReviewBriefing with file paths**

Replace the current briefing construction:
```typescript
  const briefing: ReviewBriefing = {
    page_title: page.title,
    section_position: `Page ${i + 1} of ${wiki.reading_order.length}`,
    current_page_plan: page.rationale,
    full_book_summary: wiki.summary,
    draft_file: this.storage.paths.draftPageMd(slug, jobId, versionId, page.slug),
    covered_files: page.covered_files,
    published_summaries_file: this.storage.paths.publishedIndexJson(slug, jobId),
    review_questions: [
      "Does the page stay within its assigned scope?",
      "Are all key claims backed by citations from the repository?",
      "Are there covered files that should be referenced but aren't?",
    ],
    // Pass previous review for differential mode
    ...(attempt > 0 && reviewResult?.conclusion ? {
      previous_review: reviewResult.conclusion,
      revision_diff_summary: `Revision attempt ${attempt} addressing: ${reviewResult.conclusion.blockers.join("; ")}`,
    } : {}),
  };
```

- [ ] **Step 2: Run tests + rebuild + commit**

```bash
pnpm -w test
pnpm --filter @reporead/core build && pnpm --filter @reporead/cli build
git add packages/core/src/generation/generation-pipeline.ts
git commit -m "feat(pipeline): wire file-based ReviewBriefing with differential review support"
```

---

### Task 3: Incremental evidence re-collection

**Files:**
- Modify: `packages/core/src/generation/evidence-coordinator.ts`
- Modify: `packages/core/src/generation/generation-pipeline.ts`

- [ ] **Step 1: Add existingLedger and focusAreas to CollectInput**

```typescript
export type CollectInput = {
  // ... existing fields ...
  existingLedger?: Array<{ id: string; kind: string; target: string; note: string }>;
  focusAreas?: string[];
};
```

- [ ] **Step 2: Coordinator merges instead of replaces**

When `existingLedger` is provided:
- Pass `focusAreas` to the planner as additional context
- After workers complete, merge new findings into existingLedger (deduplicate by target+locator)
- Return the merged result

- [ ] **Step 3: Pipeline passes existing evidence on retry**

When `shouldCollectEvidence` is true and `evidenceResult` already exists:
```typescript
  evidenceResult = await coordinator!.collect({
    ...collectInput,
    existingLedger: evidenceResult.ledger,
    focusAreas: reviewResult?.conclusion?.missing_evidence ?? [],
  });
```

- [ ] **Step 4: Run tests + commit**

```bash
pnpm -w test
git add packages/core/src/generation/evidence-coordinator.ts \
       packages/core/src/generation/generation-pipeline.ts
git commit -m "feat(evidence): incremental re-collection — merge into existing ledger, only target flagged areas"
```

---

### Task 4: Deterministic quality checks

**Files:**
- Modify: `packages/core/src/validation/page-validator.ts`
- Modify: `packages/core/src/generation/generation-pipeline.ts`
- Modify: `packages/core/src/generation/page-drafter-prompt.ts`

- [ ] **Step 1: Add citation density check to validator**

In `page-validator.ts`, add a check that scans each `##` section for `[cite:` markers. Sections with zero citations produce a warning (not a blocking error).

- [ ] **Step 2: Auto-compute relatedPages**

In the pipeline after validation, compute related pages from `covered_files` overlap:
```typescript
  const relatedPages = wiki.reading_order
    .filter((p) => p.slug !== page.slug)
    .filter((p) => p.covered_files.some((f) => page.covered_files.includes(f)))
    .map((p) => p.slug);
  pageMeta.relatedPages = [...new Set([...pageMeta.relatedPages, ...relatedPages])];
```

- [ ] **Step 3: Add anti-pattern guidance to drafter prompt**

In `page-drafter-prompt.ts` system prompt, add:
```
Do NOT:
- Use "Let's dive in/explore/take a look" openings
- Add summary paragraphs at the end of sections ("In this section, we learned...")
- Convert every paragraph into bullet lists
- Use hedging phrases like "It's worth noting that" or "Interestingly"
```

- [ ] **Step 4: Run tests + rebuild + commit**

```bash
pnpm -w test
pnpm --filter @reporead/core build && pnpm --filter @reporead/cli build
git add packages/core/src/validation/page-validator.ts \
       packages/core/src/generation/generation-pipeline.ts \
       packages/core/src/generation/page-drafter-prompt.ts
git commit -m "feat(quality): citation density check, auto relatedPages, drafter anti-patterns"
```

---

## Verification

- Reviewer debug log shows `read` tool calls to draft file and source files
- Revision review prompt is noticeably shorter (only flagged issues)
- Evidence re-collection on retry only dispatches workers for focus areas
- `relatedPages` in pageMeta is populated for pages sharing covered_files
- All tests pass
