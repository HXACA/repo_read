# Phase 1: P1 Fixes + Engineering Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix credential resolution across all commands, remove dead Web API key UI, align doctor checks, offline-ize web build, and shore up ForkWorker + engineering foundations.

**Architecture:** Extract a shared `resolveApiKeys()` function in core that all CLI commands and Web routes call. Remove the browser-local API key UI. Fix doctor to read the same engine/credential logic as real commands. Replace Google Fonts with local fonts. Add `maxSteps` to ForkWorker and use shared `extractJson`. Move per-page object construction outside the loop.

**Tech Stack:** TypeScript strict, Vitest, Node.js 22, Vercel AI SDK, Next.js 15, Ink 5

---

## File Structure

### New Files

```
packages/core/src/config/resolve-api-keys.ts          — shared env→config.apiKey resolution
packages/core/src/config/__tests__/resolve-api-keys.test.ts
packages/web/public/fonts/CrimsonPro-*.woff2           — local font files
packages/web/public/fonts/Outfit-*.woff2
packages/web/public/fonts/JetBrainsMono-*.woff2
```

### Modified Files

```
packages/cli/src/commands/generate.tsx       — use resolveApiKeys, pass profile to pipeline
packages/cli/src/commands/ask.tsx            — use resolveApiKeys instead of SecretStore loop
packages/cli/src/commands/research.tsx       — use resolveApiKeys instead of SecretStore loop
packages/cli/src/commands/doctor.ts          — use resolveApiKeys, read engines.node from package.json
packages/web/src/app/api/.../ask/route.ts    — use resolveApiKeys
packages/web/src/lib/settings-context.tsx    — remove apiKey from Settings type
packages/web/src/lib/settings-panel.tsx      — remove API key input section
packages/web/src/app/layout.tsx              — switch from next/font/google to next/font/local
packages/core/src/generation/fork-worker.ts  — add maxSteps, use extractJson
packages/core/src/config/quality-profile.ts  — add workerMaxSteps
packages/core/src/generation/generation-pipeline.ts — construct agents outside page loop, pass profile
packages/core/src/index.ts                   — export resolveApiKeys
packages/core/src/config/index.ts            — export resolveApiKeys
```

---

### Task 1: Shared `resolveApiKeys` function

**Files:**
- Create: `packages/core/src/config/resolve-api-keys.ts`
- Create: `packages/core/src/config/__tests__/resolve-api-keys.test.ts`
- Modify: `packages/core/src/config/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the test**

```typescript
// packages/core/src/config/__tests__/resolve-api-keys.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveApiKeys } from "../resolve-api-keys.js";
import type { UserEditableConfig } from "../../types/config.js";

const baseConfig: UserEditableConfig = {
  projectSlug: "test",
  repoRoot: "/tmp",
  preset: "quality",
  providers: [
    { provider: "openrouter", npm: "@ai-sdk/openai-compatible", secretRef: "OPENROUTER_KEY", apiKey: "cfg-key-1", enabled: true },
    { provider: "glm", npm: "@ai-sdk/openai-compatible", secretRef: "GLM_KEY", enabled: true },
  ],
  roles: {
    "main.author": { model: "openrouter/qwen", fallback_models: [] },
    "fork.worker": { model: "openrouter/qwen", fallback_models: [] },
    "fresh.reviewer": { model: "glm/glm-5.1", fallback_models: [] },
  },
};

describe("resolveApiKeys", () => {
  afterEach(() => {
    delete process.env.OPENROUTER_KEY;
    delete process.env.GLM_KEY;
  });

  it("uses config.apiKey when env var is not set", () => {
    const keys = resolveApiKeys(baseConfig);
    expect(keys.openrouter).toBe("cfg-key-1");
    expect(keys.glm).toBeUndefined(); // no apiKey and no env
  });

  it("prefers env var over config.apiKey", () => {
    process.env.OPENROUTER_KEY = "env-key-1";
    const keys = resolveApiKeys(baseConfig);
    expect(keys.openrouter).toBe("env-key-1");
  });

  it("skips disabled providers", () => {
    const config = {
      ...baseConfig,
      providers: [{ provider: "x", secretRef: "X", apiKey: "val", enabled: false }],
    };
    const keys = resolveApiKeys(config);
    expect(keys.x).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -w test -- --reporter=verbose packages/core/src/config/__tests__/resolve-api-keys.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement resolveApiKeys**

```typescript
// packages/core/src/config/resolve-api-keys.ts
import type { UserEditableConfig } from "../types/config.js";

/**
 * Resolve API keys for all enabled providers.
 * Priority: env var (via secretRef) > config.apiKey.
 * Used by generate, ask, research, doctor, and Web ask route.
 */
export function resolveApiKeys(config: UserEditableConfig): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const p of config.providers) {
    if (!p.enabled) continue;
    const envKey = process.env[p.secretRef] ?? null;
    if (envKey) {
      keys[p.provider] = envKey;
    } else if (p.apiKey) {
      keys[p.provider] = p.apiKey;
    }
  }
  return keys;
}
```

- [ ] **Step 4: Export from config/index.ts and core index.ts**

Add to `packages/core/src/config/index.ts`:
```typescript
export { resolveApiKeys } from "./resolve-api-keys.js";
```

Add to `packages/core/src/index.ts` (near the other config exports):
```typescript
export { resolveApiKeys } from "./config/index.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -w test -- --reporter=verbose packages/core/src/config/__tests__/resolve-api-keys.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config/resolve-api-keys.ts \
       packages/core/src/config/__tests__/resolve-api-keys.test.ts \
       packages/core/src/config/index.ts \
       packages/core/src/index.ts
git commit -m "feat(config): shared resolveApiKeys — env var > config.apiKey, used by all commands"
```

---

### Task 2: Wire `resolveApiKeys` into ask, research, generate, and Web route

**Files:**
- Modify: `packages/cli/src/commands/ask.tsx`
- Modify: `packages/cli/src/commands/research.tsx`
- Modify: `packages/cli/src/commands/generate.tsx`
- Modify: `packages/web/src/app/api/projects/[slug]/versions/[versionId]/ask/route.ts`

- [ ] **Step 1: Update ask.tsx**

Replace lines 37-44 (the SecretStore loop) with:
```typescript
  import { resolveApiKeys } from "@reporead/core";
  // ... (remove SecretStore import, remove the secretStore + apiKeys loop)
  const apiKeys = resolveApiKeys(config);
```

Full replacement: remove `SecretStore` from imports, remove lines 37-44, replace with `const apiKeys = resolveApiKeys(config);`. Add `resolveApiKeys` to the `@reporead/core` import.

- [ ] **Step 2: Update research.tsx**

Same pattern: remove SecretStore import and loop (lines 35-43), replace with:
```typescript
  const apiKeys = resolveApiKeys(config);
```
Add `resolveApiKeys` to the `@reporead/core` import.

- [ ] **Step 3: Update generate.tsx**

Replace the apiKey gathering block (lines 61-81) with:
```typescript
  const apiKeys = resolveApiKeys(config);
```
Remove the `configDirty` / `saveProjectConfig` env-key-writeback logic. Remove `SecretStore` import. Add `resolveApiKeys` to the `@reporead/core` import.

- [ ] **Step 4: Update Web ask/route.ts**

Replace lines 53-56 (the config.providers apiKey loop) with:
```typescript
  import { resolveApiKeys } from "@reporead/core";
  const apiKeys = resolveApiKeys(config);
```

- [ ] **Step 5: Run full test suite**

Run: `pnpm -w test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/ask.tsx \
       packages/cli/src/commands/research.tsx \
       packages/cli/src/commands/generate.tsx \
       packages/web/src/app/api/projects/\\[slug\\]/versions/\\[versionId\\]/ask/route.ts
git commit -m "fix(credentials): unify all commands to use resolveApiKeys — ask/research now read config.apiKey"
```

---

### Task 3: Remove Web local API key UI

**Files:**
- Modify: `packages/web/src/lib/settings-context.tsx`
- Modify: `packages/web/src/lib/settings-panel.tsx`

- [ ] **Step 1: Remove apiKey from Settings type and context**

In `settings-context.tsx`:
- Remove `apiKey: string` from the `Settings` type
- Remove `setApiKey: (k: string) => void` from `SettingsContextValue`
- Remove `apiKey: ""` from `defaults`
- Remove `setApiKey` from the context provider implementation

- [ ] **Step 2: Remove API key input from settings panel**

In `settings-panel.tsx`:
- Delete the entire `{/* API Key */}` section (approximately lines 115-136)
- Remove `apiKey` and `setApiKey` from the destructured context

- [ ] **Step 3: Verify web build**

Run: `pnpm --filter @reporead/web build` (may fail due to Google Fonts — that's OK, we fix it in Task 5)

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/lib/settings-context.tsx \
       packages/web/src/lib/settings-panel.tsx
git commit -m "fix(web): remove dead browser-local API key UI — credentials come from server config"
```

---

### Task 4: Fix doctor command

**Files:**
- Modify: `packages/cli/src/commands/doctor.ts`

- [ ] **Step 1: Fix Node version check**

Replace the hardcoded `major >= 18` check with reading from root `package.json`:

```typescript
  // Replace:
  //   if (major >= 18) ok(...)
  //   else fail(...)
  // With:
  let requiredMajor = 22;
  try {
    const rootPkg = JSON.parse(await fs.readFile(path.join(repoRoot, "node_modules", ".package-lock.json"), "utf-8"));
    // Fallback: just use 22 as declared in root package.json
  } catch { /* use default */ }
  if (major >= requiredMajor) ok(`Node.js ${nodeVer}`);
  else fail(`Node.js ${nodeVer} (need ≥${requiredMajor})`);
```

Actually, simpler: just hardcode 22 to match `package.json` and `.nvmrc`:

```typescript
  if (major >= 22) ok(`Node.js ${nodeVer}`);
  else fail(`Node.js ${nodeVer} (need ≥22)`);
```

- [ ] **Step 2: Fix credential check to use resolveApiKeys**

Replace the custom `p.apiKey || process.env[p.secretRef]` check in both global config and project config sections with:

```typescript
  import { resolveApiKeys } from "@reporead/core";

  // In the project section, replace the manual provider loop with:
  const apiKeys = resolveApiKeys(config);
  for (const p of config.providers) {
    if (!p.enabled) continue;
    if (apiKeys[p.provider]) ok(`Provider: ${p.provider} (API key set)`);
    else warn(`Provider: ${p.provider} (no API key — set ${p.secretRef} or add apiKey to config)`);
  }
```

Apply the same pattern to the global config section.

- [ ] **Step 3: Run doctor test**

Run: `pnpm -w test -- --reporter=verbose packages/cli/src/__tests__/commands/doctor.test.ts`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `pnpm -w test`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/doctor.ts
git commit -m "fix(doctor): align Node check to ≥22, use shared resolveApiKeys for credential check"
```

---

### Task 5: Web fonts offline

**Files:**
- Modify: `packages/web/src/app/layout.tsx`
- Create: font files in `packages/web/public/fonts/`

- [ ] **Step 1: Download font files**

```bash
# Download variable fonts from Google Fonts CDN
cd packages/web/public
mkdir -p fonts
curl -L "https://fonts.gstatic.com/s/outfit/v11/QGYyz_MVcBeNP4NjuGObqx1XmO1I4TC0C4G-EiAou6Y.woff2" -o fonts/Outfit-Variable.woff2
curl -L "https://fonts.gstatic.com/s/jetbrainsmono/v20/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKxjOVGPf0UaY4A.woff2" -o fonts/JetBrainsMono-Variable.woff2
curl -L "https://fonts.gstatic.com/s/crimsonpro/v24/q5uUsoa5M_tv7IihmnkabC5XiXCAlXGks1WZzm1MP5s7.woff2" -o fonts/CrimsonPro-Variable.woff2
```

If curl fails (no network), create placeholder files and add a README note. The key change is the layout.tsx switch below.

- [ ] **Step 2: Switch layout.tsx to local fonts**

Replace the Google Font imports in `packages/web/src/app/layout.tsx`:

```typescript
// BEFORE:
import { Crimson_Pro, Outfit, JetBrains_Mono } from "next/font/google";

// AFTER:
import localFont from "next/font/local";

const display = localFont({
  src: "../../public/fonts/CrimsonPro-Variable.woff2",
  variable: "--font-display",
  display: "swap",
});

const body = localFont({
  src: "../../public/fonts/Outfit-Variable.woff2",
  variable: "--font-body",
  display: "swap",
});

const mono = localFont({
  src: "../../public/fonts/JetBrainsMono-Variable.woff2",
  variable: "--font-mono",
  display: "swap",
});
```

If font files are unavailable, use system font stack as fallback:
```typescript
import localFont from "next/font/local";

// Fallback: use system fonts if woff2 files not available
const display = localFont({
  src: "../../public/fonts/CrimsonPro-Variable.woff2",
  variable: "--font-display",
  display: "swap",
  fallback: ["Georgia", "serif"],
});
```

- [ ] **Step 3: Verify build works offline**

Run: `pnpm --filter @reporead/web build`
Expected: Build succeeds without network access to fonts.googleapis.com

- [ ] **Step 4: Commit**

```bash
git add packages/web/public/fonts/ packages/web/src/app/layout.tsx
git commit -m "fix(web): switch to local fonts — offline build support, no Google Fonts dependency"
```

---

### Task 6: ForkWorker maxSteps + extractJson

**Files:**
- Modify: `packages/core/src/generation/fork-worker.ts`
- Modify: `packages/core/src/config/quality-profile.ts`

- [ ] **Step 1: Add workerMaxSteps to QualityProfile**

In `packages/core/src/config/quality-profile.ts`, add to the type:
```typescript
  workerMaxSteps: number;
```

Add to each preset:
- quality: `workerMaxSteps: 8`
- balanced: `workerMaxSteps: 6`
- budget: `workerMaxSteps: 4`
- local-only: `workerMaxSteps: 4`

- [ ] **Step 2: Add maxSteps to ForkWorker**

In `packages/core/src/generation/fork-worker.ts`:

Add to `ForkWorkerOptions`:
```typescript
  maxSteps?: number;
```

Store in constructor:
```typescript
  private readonly maxSteps: number;
  constructor(options: ForkWorkerOptions) {
    this.model = options.model;
    this.repoRoot = options.repoRoot;
    this.maxSteps = options.maxSteps ?? 8;
  }
```

Add to the `generateText` call:
```typescript
  import { stepCountIs } from "ai";
  // In execute():
  const result = await generateText({
    model: this.model,
    system: systemPrompt,
    prompt: userPrompt,
    tools: tools as unknown as ToolSet,
    stopWhen: stepCountIs(this.maxSteps),
  });
```

- [ ] **Step 3: Replace custom JSON parser with extractJson**

Replace the `parseOutput` method with:
```typescript
  import { extractJson } from "../utils/extract-json.js";

  private parseOutput(text: string): ForkWorkerResponse {
    const data = extractJson(text);
    if (!data || !data.directive || !Array.isArray(data.findings)) {
      return { success: false, error: "Invalid fork worker output: missing directive or findings" };
    }
    return {
      success: true,
      data: {
        directive: data.directive as string,
        findings: data.findings as string[],
        citations: (Array.isArray(data.citations) ? data.citations : []).map((c: Record<string, string>) => ({
          kind: c.kind ?? "file",
          target: c.target,
          locator: c.locator,
          note: c.note,
        })),
        open_questions: (data.open_questions as string[]) ?? [],
      },
    };
  }
```

- [ ] **Step 4: Pass workerMaxSteps from pipeline**

In `packages/core/src/generation/generation-pipeline.ts`, where `EvidenceCoordinator` creates workers, find the `ForkWorker` construction inside `evidence-coordinator.ts` and ensure maxSteps is passed through.

Check `evidence-coordinator.ts` — the `workerFactory` creates workers. Add `maxSteps` to `EvidenceCoordinatorOptions`:

```typescript
export type EvidenceCoordinatorOptions = {
  plannerModel: LanguageModel;
  workerModel: LanguageModel;
  repoRoot: string;
  concurrency: number;
  workerMaxSteps?: number;  // NEW
};
```

Pass it to ForkWorker in the factory:
```typescript
  this.workerFactory = () => new ForkWorker({
    model: options.workerModel,
    repoRoot: options.repoRoot,
    maxSteps: options.workerMaxSteps,
  });
```

In `generation-pipeline.ts`, pass `qp.workerMaxSteps` when constructing the coordinator.

- [ ] **Step 5: Run tests**

Run: `pnpm -w test`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/generation/fork-worker.ts \
       packages/core/src/config/quality-profile.ts \
       packages/core/src/generation/evidence-coordinator.ts \
       packages/core/src/generation/generation-pipeline.ts
git commit -m "fix(worker): add maxSteps constraint + use shared extractJson — prevents runaway workers"
```

---

### Task 7: Engineering foundations

**Files:**
- Modify: `packages/core/src/generation/generation-pipeline.ts`
- Modify: `packages/cli/src/commands/generate.tsx`
- Create: `packages/core/src/config/__tests__/config-roundtrip.test.ts`

- [ ] **Step 1: Move agent construction outside page loop**

In `generation-pipeline.ts`, move the construction of `PageDrafter`, `FreshReviewer`, `EvidenceCoordinator`, and `OutlinePlanner` from inside the `for (let i = 0; ...)` loop (lines ~203-225) to just before it (after `const qp = ...` on line 188). These objects are stateless between pages.

- [ ] **Step 2: Eliminate duplicate profileRepo**

In `generate.tsx`, the CLI already calls `profileRepo` (line 201). Pass the result to the pipeline via `PipelineRunOptions`:

Add to `PipelineRunOptions`:
```typescript
  repoProfile?: RepoProfile;
```

In `generation-pipeline.ts`, use `options.repoProfile` if provided, otherwise call `profileRepo` as fallback:
```typescript
  const profileResult = options.repoProfile ?? await profileRepo(this.repoRoot, slug);
```

In `generate.tsx`, pass the profile:
```typescript
  const result = await pipeline.run(job, {
    ...(resumeWith ? { resumeWith } : {}),
    repoProfile: profile,  // from the earlier profileRepo call
    onEvent: (event) => { ... },
  });
```

- [ ] **Step 3: Add config round-trip test**

```typescript
// packages/core/src/config/__tests__/config-roundtrip.test.ts
import { describe, it, expect } from "vitest";
import { parseUserEditableConfig } from "../schema.js";

describe("config round-trip", () => {
  it("preserves all fields through Zod parse", () => {
    const input = {
      projectSlug: "test",
      repoRoot: "/tmp",
      preset: "quality",
      language: "zh",
      providers: [{
        provider: "openrouter",
        npm: "@ai-sdk/openai-compatible",
        secretRef: "KEY",
        apiKey: "sk-test",
        baseUrl: "https://example.com",
        enabled: true,
      }],
      roles: {
        "main.author": { model: "openrouter/qwen", provider: "openrouter", fallback_models: [] },
        "fork.worker": { model: "openrouter/qwen", fallback_models: [] },
        "fresh.reviewer": { model: "glm/glm-5.1", provider: "glm", fallback_models: [] },
      },
      qualityOverrides: { catalogMaxSteps: 80, workerMaxSteps: 10 },
    };

    const parsed = parseUserEditableConfig(input);
    expect(parsed.providers[0].npm).toBe("@ai-sdk/openai-compatible");
    expect(parsed.providers[0].apiKey).toBe("sk-test");
    expect(parsed.providers[0].baseUrl).toBe("https://example.com");
    expect(parsed.roles["main.author"].provider).toBe("openrouter");
    expect(parsed.qualityOverrides?.catalogMaxSteps).toBe(80);
    expect(parsed.qualityOverrides?.workerMaxSteps).toBe(10);
  });
});
```

- [ ] **Step 4: Run full suite + rebuild**

Run: `pnpm -w test && pnpm --filter @reporead/core build && pnpm --filter @reporead/cli build`
Expected: All pass, both packages build

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/generation/generation-pipeline.ts \
       packages/cli/src/commands/generate.tsx \
       packages/core/src/config/__tests__/config-roundtrip.test.ts
git commit -m "refactor(pipeline): agents outside loop, eliminate duplicate profileRepo, add config round-trip test"
```

---

## Execution Order

Tasks 1-7 are mostly sequential (Task 2 depends on Task 1, Task 4 depends on Task 1), but some can be parallelized:

1. **Task 1** (resolveApiKeys) — must be first
2. **Task 2** (wire into commands) + **Task 3** (remove Web API key UI) — parallel after Task 1
3. **Task 4** (doctor) — after Task 1
4. **Task 5** (fonts) — independent, can run anytime
5. **Task 6** (ForkWorker) — independent
6. **Task 7** (engineering) — independent, do last as cleanup

**Estimated total: ~3-4 hours**
