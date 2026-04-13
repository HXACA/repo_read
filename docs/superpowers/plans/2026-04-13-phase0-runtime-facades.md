# Phase 0: Runtime Facades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Phase 0 的四个 facade 与最小 adapter 接入：`TurnEngineAdapter`、`PromptAssembler`、`ArtifactStore`、`Phase 0 exports`。要求 generation 链开始“经过”新层，但外部行为不变。

**Architecture:** 严格遵守 [runtime-refactor-blueprint-2026-04-13.md](../../runtime-refactor-blueprint-2026-04-13.md) 的 `Phase 0` 边界：先定接口、接 adapter、不改行为。具体做法是：
- 新建 `runtime/`、`prompt/`、`artifacts/` facade
- `PageDrafter` / `ForkWorker` / `FreshReviewer` / `CatalogPlanner` 从直接调 `runAgentLoop()` 改成调 `TurnEngineAdapter`
- `GenerationPipeline` 对 evidence / outline / review / published index 改走 `ArtifactStore`
- **不改 ask/research，不改 prompt 文案，不改 step budgets，不改 retry 行为**

**Tech Stack:** TypeScript, AI SDK v6 (`ai`), Vitest, pnpm workspace

---

## 文件结构

### Create

- `packages/core/src/runtime/turn-types.ts`
- `packages/core/src/runtime/turn-engine.ts`
- `packages/core/src/runtime/index.ts`
- `packages/core/src/runtime/__tests__/turn-engine.test.ts`
- `packages/core/src/prompt/types.ts`
- `packages/core/src/prompt/assembler.ts`
- `packages/core/src/prompt/index.ts`
- `packages/core/src/prompt/__tests__/assembler.test.ts`
- `packages/core/src/artifacts/types.ts`
- `packages/core/src/artifacts/artifact-store.ts`
- `packages/core/src/artifacts/index.ts`
- `packages/core/src/artifacts/__tests__/artifact-store.test.ts`

### Modify

- `packages/core/src/generation/page-drafter.ts`
- `packages/core/src/generation/fork-worker.ts`
- `packages/core/src/review/reviewer.ts`
- `packages/core/src/catalog/catalog-planner.ts`
- `packages/core/src/generation/generation-pipeline.ts`
- `packages/core/src/index.ts`

### Explicitly Not Modified In Phase 0

- `packages/core/src/ask/*`
- `packages/core/src/research/*`
- 所有 prompt 文案文件
- `packages/core/src/utils/generate-via-stream.ts`
- `packages/core/src/providers/*`

---

### Task 1: Add Turn Runtime Types And `TurnEngineAdapter`

**Files:**
- Create: `packages/core/src/runtime/turn-types.ts`
- Create: `packages/core/src/runtime/turn-engine.ts`
- Create: `packages/core/src/runtime/index.ts`
- Test: `packages/core/src/runtime/__tests__/turn-engine.test.ts`

- [ ] **Step 1: Create the runtime directory**

Run: `mkdir -p packages/core/src/runtime/__tests__`
Expected: `packages/core/src/runtime/__tests__` exists

- [ ] **Step 2: Write the failing runtime test**

```typescript
// packages/core/src/runtime/__tests__/turn-engine.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StepInfo } from "../../agent/agent-loop.js";
import { TurnEngineAdapter } from "../turn-engine.js";
import type { TurnRequest } from "../turn-types.js";

const step: StepInfo = {
  stepIndex: 0,
  inputTokens: 10,
  outputTokens: 20,
  reasoningTokens: 0,
  cachedTokens: 0,
  toolCalls: [],
  finishReason: "stop",
};

describe("TurnEngineAdapter", () => {
  const invokeTurn = vi.fn();
  const setModelOptions = vi.fn();
  let engine: TurnEngineAdapter;

  beforeEach(() => {
    invokeTurn.mockReset();
    setModelOptions.mockReset();
    engine = new TurnEngineAdapter({
      invokeTurn,
      setModelOptions,
    });
  });

  it("delegates to invokeTurn and normalizes the result", async () => {
    invokeTurn.mockResolvedValue({
      text: "draft-body",
      messages: [{ role: "assistant", content: "draft-body" }],
      totalUsage: {
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 5,
        cachedTokens: 10,
      },
      steps: [step],
    });

    const request: TurnRequest = {
      purpose: "draft",
      model: {} as any,
      systemPrompt: "system",
      userPrompt: "user",
      tools: {},
      policy: {
        maxSteps: 20,
        retry: { maxRetries: 0, baseDelayMs: 0, backoffFactor: 1 },
        overflow: { strategy: "none" },
        toolBatch: { strategy: "sequential" },
      },
    };

    const result = await engine.run(request);

    expect(invokeTurn).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("draft-body");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 5,
      cachedTokens: 10,
    });
  });

  it("passes maxOutputTokens and onStep through", async () => {
    const onStep = vi.fn();
    invokeTurn.mockResolvedValue({
      text: "ok",
      messages: [],
      totalUsage: {
        inputTokens: 1,
        outputTokens: 1,
        reasoningTokens: 0,
        cachedTokens: 0,
      },
      steps: [step],
    });

    await engine.run({
      purpose: "review",
      model: {} as any,
      systemPrompt: "system",
      userPrompt: "user",
      tools: {},
      policy: {
        maxSteps: 10,
        maxOutputTokens: 4096,
        retry: { maxRetries: 0, baseDelayMs: 0, backoffFactor: 1 },
        overflow: { strategy: "none" },
        toolBatch: { strategy: "sequential" },
      },
      onStep,
    });

    expect(invokeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        maxSteps: 10,
        maxOutputTokens: 4096,
        onStep,
      }),
      "user",
    );
  });

  it("applies provider options only when provided", async () => {
    invokeTurn.mockResolvedValue({
      text: "ok",
      messages: [],
      totalUsage: {
        inputTokens: 1,
        outputTokens: 1,
        reasoningTokens: 0,
        cachedTokens: 0,
      },
      steps: [step],
    });

    await engine.run({
      purpose: "catalog",
      model: {} as any,
      systemPrompt: "system",
      userPrompt: "user",
      tools: {},
      policy: {
        maxSteps: 5,
        retry: { maxRetries: 0, baseDelayMs: 0, backoffFactor: 1 },
        overflow: { strategy: "none" },
        toolBatch: { strategy: "sequential" },
        providerOptions: {
          reasoning: { effort: "medium", summary: "auto" },
          serviceTier: "fast",
        },
      },
    });

    expect(setModelOptions).toHaveBeenCalledWith({
      reasoning: { effort: "medium", summary: "auto" },
      serviceTier: "fast",
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/runtime/__tests__/turn-engine.test.ts`
Expected: FAIL with module-not-found errors for `../turn-engine.js`

- [ ] **Step 4: Add runtime type definitions**

```typescript
// packages/core/src/runtime/turn-types.ts
import type { LanguageModel, ToolSet } from "ai";
import type { Message, StepInfo } from "../agent/agent-loop.js";

export type TurnPurpose =
  | "catalog"
  | "outline"
  | "draft"
  | "worker"
  | "review"
  | "ask"
  | "research-plan"
  | "research-exec"
  | "research-synthesize";

export type ProviderCallOptions = {
  cacheKey?: string;
  reasoning?: { effort: string; summary: string } | null;
  serviceTier?: string | null;
};

export type RetryPolicy = {
  maxRetries: number;
  baseDelayMs: number;
  backoffFactor: number;
};

export type OverflowPolicy = {
  strategy: "none" | "truncate" | "compact";
};

export type ToolBatchPolicy = {
  strategy: "sequential" | "parallel";
};

export type TurnPolicy = {
  maxSteps: number;
  maxOutputTokens?: number;
  retry: RetryPolicy;
  overflow: OverflowPolicy;
  toolBatch: ToolBatchPolicy;
  providerOptions?: ProviderCallOptions;
};

export type TurnRequest = {
  purpose: TurnPurpose;
  model: LanguageModel;
  systemPrompt: string;
  userPrompt: string;
  tools: ToolSet;
  policy: TurnPolicy;
  onStep?: (step: StepInfo) => void;
};

export type TurnResult = {
  text: string;
  messages: Message[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
  };
  steps: StepInfo[];
  finishReason: string;
};
```

- [ ] **Step 5: Add the adapter implementation**

```typescript
// packages/core/src/runtime/turn-engine.ts
import { runAgentLoop } from "../agent/agent-loop.js";
import { setModelOptions } from "../utils/generate-via-stream.js";
import type { TurnRequest, TurnResult } from "./turn-types.js";

type RunAgentLoopLike = typeof runAgentLoop;

export type TurnEngineAdapterOptions = {
  invokeTurn?: RunAgentLoopLike;
  setModelOptions?: typeof setModelOptions;
};

export class TurnEngineAdapter {
  private readonly invokeTurn: RunAgentLoopLike;
  private readonly applyModelOptions: typeof setModelOptions;

  constructor(options: TurnEngineAdapterOptions = {}) {
    this.invokeTurn = options.invokeTurn ?? runAgentLoop;
    this.applyModelOptions = options.setModelOptions ?? setModelOptions;
  }

  async run(request: TurnRequest): Promise<TurnResult> {
    const providerOptions = request.policy.providerOptions;
    if (providerOptions?.reasoning || providerOptions?.serviceTier) {
      this.applyModelOptions({
        reasoning: providerOptions.reasoning ?? null,
        serviceTier: providerOptions.serviceTier ?? null,
      });
    }

    const result = await this.invokeTurn(
      {
        model: request.model,
        system: request.systemPrompt,
        tools: request.tools,
        maxSteps: request.policy.maxSteps,
        maxOutputTokens: request.policy.maxOutputTokens,
        onStep: request.onStep,
      },
      request.userPrompt,
    );

    return {
      text: result.text,
      messages: result.messages,
      usage: {
        inputTokens: result.totalUsage.inputTokens,
        outputTokens: result.totalUsage.outputTokens,
        reasoningTokens: result.totalUsage.reasoningTokens,
        cachedTokens: result.totalUsage.cachedTokens,
      },
      steps: result.steps,
      finishReason:
        result.steps[result.steps.length - 1]?.finishReason ?? "unknown",
    };
  }
}
```

```typescript
// packages/core/src/runtime/index.ts
export { TurnEngineAdapter } from "./turn-engine.js";
export type {
  TurnPurpose,
  ProviderCallOptions,
  RetryPolicy,
  OverflowPolicy,
  ToolBatchPolicy,
  TurnPolicy,
  TurnRequest,
  TurnResult,
} from "./turn-types.js";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/runtime/__tests__/turn-engine.test.ts`
Expected: 3 tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/runtime/
git commit -m "refactor(phase0): add TurnEngine adapter facade"
```

---

### Task 2: Add Prompt Types And `PromptAssembler`

**Files:**
- Create: `packages/core/src/prompt/types.ts`
- Create: `packages/core/src/prompt/assembler.ts`
- Create: `packages/core/src/prompt/index.ts`
- Test: `packages/core/src/prompt/__tests__/assembler.test.ts`

- [ ] **Step 1: Create the prompt directory**

Run: `mkdir -p packages/core/src/prompt/__tests__`
Expected: `packages/core/src/prompt/__tests__` exists

- [ ] **Step 2: Write the failing assembler test**

```typescript
// packages/core/src/prompt/__tests__/assembler.test.ts
import { describe, it, expect } from "vitest";
import { PromptAssembler } from "../assembler.js";

describe("PromptAssembler", () => {
  it("passes through system and user prompt unchanged in phase 0", () => {
    const assembler = new PromptAssembler();
    const result = assembler.assemble({
      role: "drafter",
      language: "zh",
      systemPrompt: "system-body",
      userPrompt: "user-body",
    });

    expect(result.system).toBe("system-body");
    expect(result.user).toBe("user-body");
    expect(result.role).toBe("drafter");
    expect(result.language).toBe("zh");
  });

  it("retains sections metadata for future phases", () => {
    const assembler = new PromptAssembler();
    const result = assembler.assemble({
      role: "reviewer",
      language: "en",
      systemPrompt: "review-system",
      userPrompt: "review-user",
    });

    expect(result.sections.base).toEqual([]);
    expect(result.sections.roleSpecific).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/prompt/__tests__/assembler.test.ts`
Expected: FAIL with module-not-found errors for `../assembler.js`

- [ ] **Step 4: Add prompt types and assembler**

```typescript
// packages/core/src/prompt/types.ts
export type PromptRole =
  | "catalog"
  | "outline"
  | "drafter"
  | "worker"
  | "reviewer"
  | "ask"
  | "research";

export type PromptAssemblyInput = {
  role: PromptRole;
  language: string;
  systemPrompt: string;
  userPrompt: string;
};

export type AssembledPrompt = {
  role: PromptRole;
  language: string;
  system: string;
  user: string;
  sections: {
    base: string[];
    developer: string[];
    contextualUser: string[];
    roleSpecific: string[];
  };
};
```

```typescript
// packages/core/src/prompt/assembler.ts
import type { AssembledPrompt, PromptAssemblyInput } from "./types.js";

/**
 * Phase 0 prompt facade.
 * Current behavior is pure passthrough so callers can start depending on a
 * stable interface before we move to section-based assembly in Phase 2.
 */
export class PromptAssembler {
  assemble(input: PromptAssemblyInput): AssembledPrompt {
    return {
      role: input.role,
      language: input.language,
      system: input.systemPrompt,
      user: input.userPrompt,
      sections: {
        base: [],
        developer: [],
        contextualUser: [],
        roleSpecific: [],
      },
    };
  }
}
```

```typescript
// packages/core/src/prompt/index.ts
export { PromptAssembler } from "./assembler.js";
export type { PromptRole, PromptAssemblyInput, AssembledPrompt } from "./types.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/prompt/__tests__/assembler.test.ts`
Expected: 2 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/prompt/
git commit -m "refactor(phase0): add PromptAssembler facade"
```

---

### Task 3: Add Typed `ArtifactStore`

**Files:**
- Create: `packages/core/src/artifacts/types.ts`
- Create: `packages/core/src/artifacts/artifact-store.ts`
- Create: `packages/core/src/artifacts/index.ts`
- Test: `packages/core/src/artifacts/__tests__/artifact-store.test.ts`

- [ ] **Step 1: Create the artifacts directory**

Run: `mkdir -p packages/core/src/artifacts/__tests__`
Expected: `packages/core/src/artifacts/__tests__` exists

- [ ] **Step 2: Write the failing artifact-store test**

```typescript
// packages/core/src/artifacts/__tests__/artifact-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactStore } from "../artifact-store.js";
import type { StorageAdapter } from "../../storage/storage-adapter.js";

function mockStorage(): StorageAdapter {
  return {
    paths: {
      evidenceJson: vi.fn().mockReturnValue("/mock/evidence.json"),
      outlineJson: vi.fn().mockReturnValue("/mock/outline.json"),
      reviewJson: vi.fn().mockReturnValue("/mock/review.json"),
      publishedIndexJson: vi.fn().mockReturnValue("/mock/published-index.json"),
      askSessionJson: vi.fn().mockReturnValue("/mock/ask-session.json"),
      researchNoteJson: vi.fn().mockReturnValue("/mock/research-note.json"),
    },
    readJson: vi.fn().mockResolvedValue(null),
    writeJson: vi.fn().mockResolvedValue(undefined),
  } as unknown as StorageAdapter;
}

describe("ArtifactStore", () => {
  let storage: StorageAdapter;
  let store: ArtifactStore;

  beforeEach(() => {
    storage = mockStorage();
    store = new ArtifactStore(storage);
  });

  it("loads evidence via typed page ref", async () => {
    await store.loadEvidence({
      projectSlug: "proj",
      jobId: "job-1",
      pageSlug: "overview",
    });

    expect(storage.paths.evidenceJson).toHaveBeenCalledWith("proj", "job-1", "overview");
    expect(storage.readJson).toHaveBeenCalledWith("/mock/evidence.json");
  });

  it("saves review via typed page ref", async () => {
    await store.saveReview(
      { projectSlug: "proj", jobId: "job-1", pageSlug: "overview" },
      { verdict: "pass" },
    );

    expect(storage.paths.reviewJson).toHaveBeenCalledWith("proj", "job-1", "overview");
    expect(storage.writeJson).toHaveBeenCalledWith("/mock/review.json", { verdict: "pass" });
  });

  it("loads ask session via typed ref", async () => {
    await store.loadAskSession({ projectSlug: "proj", sessionId: "ask-1" });
    expect(storage.paths.askSessionJson).toHaveBeenCalledWith("proj", "ask-1");
    expect(storage.readJson).toHaveBeenCalledWith("/mock/ask-session.json");
  });

  it("loads research note via typed ref", async () => {
    await store.loadResearchNote({
      projectSlug: "proj",
      versionId: "v1",
      noteId: "note-1",
    });
    expect(storage.paths.researchNoteJson).toHaveBeenCalledWith("proj", "v1", "note-1");
    expect(storage.readJson).toHaveBeenCalledWith("/mock/research-note.json");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/artifacts/__tests__/artifact-store.test.ts`
Expected: FAIL with module-not-found errors for `../artifact-store.js`

- [ ] **Step 4: Add typed refs and store facade**

```typescript
// packages/core/src/artifacts/types.ts
export type PageRef = {
  projectSlug: string;
  jobId: string;
  pageSlug: string;
};

export type JobRef = {
  projectSlug: string;
  jobId: string;
};

export type AskSessionRef = {
  projectSlug: string;
  sessionId: string;
};

export type ResearchNoteRef = {
  projectSlug: string;
  versionId: string;
  noteId: string;
};
```

```typescript
// packages/core/src/artifacts/artifact-store.ts
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type {
  AskSessionRef,
  JobRef,
  PageRef,
  ResearchNoteRef,
} from "./types.js";

/**
 * Phase 0 typed facade over StorageAdapter.
 * It only wraps existing path rules; it does not change IO behavior.
 */
export class ArtifactStore {
  constructor(private readonly storage: StorageAdapter) {}

  async loadEvidence(ref: PageRef): Promise<unknown> {
    return this.storage.readJson(
      this.storage.paths.evidenceJson(ref.projectSlug, ref.jobId, ref.pageSlug),
    );
  }

  async saveEvidence(ref: PageRef, data: unknown): Promise<void> {
    await this.storage.writeJson(
      this.storage.paths.evidenceJson(ref.projectSlug, ref.jobId, ref.pageSlug),
      data,
    );
  }

  async loadOutline(ref: PageRef): Promise<unknown> {
    return this.storage.readJson(
      this.storage.paths.outlineJson(ref.projectSlug, ref.jobId, ref.pageSlug),
    );
  }

  async saveOutline(ref: PageRef, data: unknown): Promise<void> {
    await this.storage.writeJson(
      this.storage.paths.outlineJson(ref.projectSlug, ref.jobId, ref.pageSlug),
      data,
    );
  }

  async saveReview(ref: PageRef, data: unknown): Promise<void> {
    await this.storage.writeJson(
      this.storage.paths.reviewJson(ref.projectSlug, ref.jobId, ref.pageSlug),
      data,
    );
  }

  async loadPublishedIndex(ref: JobRef): Promise<unknown> {
    return this.storage.readJson(
      this.storage.paths.publishedIndexJson(ref.projectSlug, ref.jobId),
    );
  }

  async savePublishedIndex(ref: JobRef, data: unknown): Promise<void> {
    await this.storage.writeJson(
      this.storage.paths.publishedIndexJson(ref.projectSlug, ref.jobId),
      data,
    );
  }

  async loadAskSession(ref: AskSessionRef): Promise<unknown> {
    return this.storage.readJson(
      this.storage.paths.askSessionJson(ref.projectSlug, ref.sessionId),
    );
  }

  async saveAskSession(ref: AskSessionRef, data: unknown): Promise<void> {
    await this.storage.writeJson(
      this.storage.paths.askSessionJson(ref.projectSlug, ref.sessionId),
      data,
    );
  }

  async loadResearchNote(ref: ResearchNoteRef): Promise<unknown> {
    return this.storage.readJson(
      this.storage.paths.researchNoteJson(
        ref.projectSlug,
        ref.versionId,
        ref.noteId,
      ),
    );
  }

  async saveResearchNote(ref: ResearchNoteRef, data: unknown): Promise<void> {
    await this.storage.writeJson(
      this.storage.paths.researchNoteJson(
        ref.projectSlug,
        ref.versionId,
        ref.noteId,
      ),
      data,
    );
  }
}
```

```typescript
// packages/core/src/artifacts/index.ts
export { ArtifactStore } from "./artifact-store.js";
export type { PageRef, JobRef, AskSessionRef, ResearchNoteRef } from "./types.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/artifacts/__tests__/artifact-store.test.ts`
Expected: 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/artifacts/
git commit -m "refactor(phase0): add typed ArtifactStore facade"
```

---

### Task 4: Wire Facades Into The Generation Chain With No Behavior Change

**Files:**
- Modify: `packages/core/src/generation/page-drafter.ts`
- Modify: `packages/core/src/generation/fork-worker.ts`
- Modify: `packages/core/src/review/reviewer.ts`
- Modify: `packages/core/src/catalog/catalog-planner.ts`
- Modify: `packages/core/src/generation/generation-pipeline.ts`

- [ ] **Step 1: Add `PromptAssembler` + `TurnEngineAdapter` to `PageDrafter`**

Replace the direct `runAgentLoop()` call in `packages/core/src/generation/page-drafter.ts` with:

```typescript
import { PromptAssembler } from "../prompt/assembler.js";
import { TurnEngineAdapter } from "../runtime/turn-engine.js";
```

Add fields:

```typescript
  private readonly promptAssembler: PromptAssembler;
  private readonly turnEngine: TurnEngineAdapter;
```

Initialize in constructor:

```typescript
    this.promptAssembler = new PromptAssembler();
    this.turnEngine = new TurnEngineAdapter();
```

Replace the direct loop invocation inside `draft()` with:

```typescript
      const assembled = this.promptAssembler.assemble({
        role: "drafter",
        language: input.language,
        systemPrompt,
        userPrompt,
      });

      const result = await this.turnEngine.run({
        purpose: "draft",
        model: this.model,
        systemPrompt: assembled.system,
        userPrompt: assembled.user,
        tools: tools as unknown as ToolSet,
        policy: {
          maxSteps: this.maxSteps,
          ...(this.maxOutputTokens ? { maxOutputTokens: this.maxOutputTokens } : {}),
          retry: { maxRetries: 0, baseDelayMs: 0, backoffFactor: 1 },
          overflow: { strategy: "none" },
          toolBatch: { strategy: "sequential" },
        },
        onStep: this.onStep,
      });
```

- [ ] **Step 2: Apply the same adapter pattern to `ForkWorker`, `FreshReviewer`, and `CatalogPlanner`**

Use the same changes in:

- `packages/core/src/generation/fork-worker.ts`
- `packages/core/src/review/reviewer.ts`
- `packages/core/src/catalog/catalog-planner.ts`

The only allowed differences are:

- `role`
- `purpose`
- `language`
- `policy.maxSteps`
- `policy.maxOutputTokens`

Specifically:

```typescript
// ForkWorker
role: "worker"
purpose: "worker"

// FreshReviewer
role: "reviewer"
purpose: "review"

// CatalogPlanner
role: "catalog"
purpose: "catalog"
language: this.language
```

- [ ] **Step 3: Add `ArtifactStore` to `GenerationPipeline`**

At the top of `packages/core/src/generation/generation-pipeline.ts` add:

```typescript
import { ArtifactStore } from "../artifacts/artifact-store.js";
```

Add a field:

```typescript
  private readonly artifacts: ArtifactStore;
```

Initialize it in the constructor:

```typescript
    this.artifacts = new ArtifactStore(this.storage);
```

Replace the following direct storage calls:

```typescript
// existing evidence load/save
this.storage.readJson(this.storage.paths.evidenceJson(...))
this.storage.writeJson(this.storage.paths.evidenceJson(...), ...)

// existing outline save
this.storage.writeJson(this.storage.paths.outlineJson(...), ...)

// existing review save
this.storage.writeJson(this.storage.paths.reviewJson(...), ...)

// existing published index read/write
this.storage.writeJson(this.storage.paths.publishedIndexJson(...), ...)
```

with:

```typescript
await this.artifacts.loadEvidence({
  projectSlug: slug,
  jobId,
  pageSlug: page.slug,
});

await this.artifacts.saveEvidence(
  { projectSlug: slug, jobId, pageSlug: page.slug },
  { ledger: evidenceResult.ledger, findings: evidenceResult.findings, openQuestions: evidenceResult.openQuestions, failedTaskIds: evidenceResult.failedTaskIds },
);

await this.artifacts.saveOutline(
  { projectSlug: slug, jobId, pageSlug: page.slug },
  outline,
);

await this.artifacts.saveReview(
  { projectSlug: slug, jobId, pageSlug: page.slug },
  finalReview.conclusion,
);

await this.artifacts.savePublishedIndex(
  { projectSlug: slug, jobId },
  publishedSummaries,
);
```

- [ ] **Step 4: Run focused generation tests**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/generation/__tests__/page-drafter.test.ts src/generation/__tests__/fork-worker.test.ts src/review/__tests__/reviewer.test.ts src/generation/__tests__/generation-pipeline.test.ts src/catalog/__tests__/catalog-planner.test.ts`
Expected: all targeted tests PASS

- [ ] **Step 5: Commit**

```bash
git add \
  packages/core/src/generation/page-drafter.ts \
  packages/core/src/generation/fork-worker.ts \
  packages/core/src/review/reviewer.ts \
  packages/core/src/catalog/catalog-planner.ts \
  packages/core/src/generation/generation-pipeline.ts
git commit -m "refactor(phase0): route generation chain through runtime and artifact facades"
```

---

### Task 5: Export Facades And Run Phase 0 Validation

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Export the new modules**

Append this to `packages/core/src/index.ts`:

```typescript
export { TurnEngineAdapter } from "./runtime/index.js";
export type {
  TurnPurpose,
  ProviderCallOptions,
  RetryPolicy,
  OverflowPolicy,
  ToolBatchPolicy,
  TurnPolicy,
  TurnRequest,
  TurnResult,
} from "./runtime/index.js";

export { PromptAssembler } from "./prompt/index.js";
export type {
  PromptRole,
  PromptAssemblyInput,
  AssembledPrompt,
} from "./prompt/index.js";

export { ArtifactStore } from "./artifacts/index.js";
export type {
  PageRef,
  JobRef,
  AskSessionRef,
  ResearchNoteRef,
} from "./artifacts/index.js";
```

- [ ] **Step 2: Run the new facade test suite**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/runtime/__tests__/turn-engine.test.ts src/prompt/__tests__/assembler.test.ts src/artifacts/__tests__/artifact-store.test.ts`
Expected: 9 tests PASS

- [ ] **Step 3: Run the full core test suite**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run`
Expected: all existing tests plus new facade tests PASS

- [ ] **Step 4: Build core and cli**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core build && pnpm --filter @reporead/cli build`
Expected: both builds PASS

- [ ] **Step 5: Verify Phase 0 boundary conditions**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && rg -n "runAgentLoop|runAgentLoopStream" packages/core/src/generation packages/core/src/review packages/core/src/catalog`
Expected: no matches in `page-drafter.ts`, `fork-worker.ts`, `reviewer.ts`, `catalog-planner.ts`; remaining matches outside those files are acceptable in Phase 0

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && git diff -- packages/core/src/ask packages/core/src/research packages/core/src/utils/generate-via-stream.ts packages/core/src/providers`
Expected: empty diff

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "refactor(phase0): export runtime prompt and artifact facades"
```

---

## Phase 0 Acceptance Checklist

- [ ] New `runtime/`, `prompt/`, and `artifacts/` facades exist under `packages/core/src/`
- [ ] `TurnEngineAdapter` wraps `runAgentLoop()` and normalizes turn results
- [ ] `PromptAssembler` exists and is used by generation components
- [ ] `ArtifactStore` exists and is used by `GenerationPipeline` for evidence / outline / review / published index
- [ ] `PageDrafter`, `ForkWorker`, `FreshReviewer`, and `CatalogPlanner` no longer call `runAgentLoop()` directly
- [ ] `packages/core/src/ask/*` and `packages/core/src/research/*` remain unchanged
- [ ] `packages/core/src/utils/generate-via-stream.ts` remains unchanged
- [ ] Full `@reporead/core` Vitest suite passes
- [ ] `@reporead/core` and `@reporead/cli` build successfully

---

Plan complete and saved to `docs/superpowers/plans/2026-04-13-phase0-runtime-facades.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

