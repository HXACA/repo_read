# Provider Protocol Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dynamic protocol selection for `@ai-sdk/openai` — `.responses()` for gpt-5+ models, `.chat()` for others — matching OpenCode's pattern. Remove `store: true` hack from generateViaStream.

**Architecture:** Add `variant` field to ProviderModelConfig (`"responses" | "chat"`). Model factory auto-detects variant from model name when not declared. `generateViaStream` becomes a pure wrapper with zero provider-specific logic.

**Tech Stack:** TypeScript strict, Vitest, Vercel AI SDK (`@ai-sdk/openai`), Node.js 22

---

## File Structure

### Modified Files

```
packages/core/src/types/config.ts                      — ProviderModelConfig adds variant field
packages/core/src/config/schema.ts                      — Zod schema adds variant
packages/core/src/providers/model-factory.ts            — @ai-sdk/openai: dynamic .responses() vs .chat()
packages/core/src/providers/__tests__/model-factory.test.ts — test protocol variant selection
packages/core/src/utils/generate-via-stream.ts          — remove store:true hack
```

---

### Task 1: Add `variant` to ProviderModelConfig + schema

**Files:**
- Modify: `packages/core/src/types/config.ts`
- Modify: `packages/core/src/config/schema.ts`

- [ ] **Step 1: Add variant to ProviderModelConfig type**

In `packages/core/src/types/config.ts`, update `ProviderModelConfig`:

```typescript
/** Per-model config declared within a provider. */
export type ProviderModelConfig = {
  name?: string;
  /** Override the provider's default npm for this specific model. */
  npm?: ProviderSdk;
  /** Protocol variant for @ai-sdk/openai: "responses" or "chat".
   *  When omitted, auto-detected from model name (gpt-5+ → responses, else chat). */
  variant?: "responses" | "chat";
};
```

- [ ] **Step 2: Add variant to Zod schema**

In `packages/core/src/config/schema.ts`, update `ProviderModelConfigSchema`:

```typescript
const ProviderModelConfigSchema = z.object({
  name: z.string().optional(),
  npm: ProviderSdkSchema.optional(),
  variant: z.enum(["responses", "chat"]).optional(),
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm -w test`
Expected: All pass (additive change, no breakage)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types/config.ts packages/core/src/config/schema.ts
git commit -m "feat(config): add variant field to ProviderModelConfig — responses vs chat protocol selection"
```

---

### Task 2: Model factory dynamic protocol selection

**Files:**
- Modify: `packages/core/src/providers/model-factory.ts`

- [ ] **Step 1: Add auto-detect function**

Add above `createModel` function:

```typescript
/**
 * Auto-detect OpenAI protocol variant from model name.
 * Matches OpenCode's shouldUseCopilotResponsesApi pattern:
 * gpt-5+ (except gpt-5-mini) → responses, everything else → chat.
 */
function detectOpenAIVariant(modelId: string): "responses" | "chat" {
  const match = /^gpt-(\d+)/.exec(modelId);
  if (!match) return "chat";
  const major = Number(match[1]);
  if (major >= 5 && !modelId.startsWith("gpt-5-mini")) return "responses";
  return "chat";
}
```

- [ ] **Step 2: Update createModel to use variant**

Change `createModel` signature to accept optional `variant`:

```typescript
function createModel(
  npm: ProviderSdk,
  providerName: string,
  modelId: string,
  apiKey: string,
  baseUrl?: string,
  fetchFn?: typeof globalThis.fetch,
  variant?: "responses" | "chat",
): LanguageModel {
```

Update the `@ai-sdk/openai` case:

```typescript
    case "@ai-sdk/openai": {
      const openai = createOpenAI({
        apiKey,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
        ...(fetchFn ? { fetch: fetchFn } : {}),
      });
      const resolved = variant ?? detectOpenAIVariant(modelId);
      return resolved === "responses"
        ? openai.responses(modelId)
        : openai(modelId);
    }
```

- [ ] **Step 3: Pass variant from createModelForRole**

In `createModelForRole`, pass `modelConfig?.variant` to `createModel`:

```typescript
  return createModel(npm, resolvedProviderName, modelName, apiKey, providerConfig?.baseUrl, fetchFn, modelConfig?.variant);
```

- [ ] **Step 4: Run tests**

Run: `pnpm -w test`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/model-factory.ts
git commit -m "feat(providers): dynamic protocol selection — .responses() for gpt-5+, .chat() for others, configurable via variant"
```

---

### Task 3: Update model-factory tests

**Files:**
- Modify: `packages/core/src/providers/__tests__/model-factory.test.ts`

- [ ] **Step 1: Add variant detection tests**

Add test cases:

```typescript
  it("uses .responses() for gpt-5.4 (auto-detect)", () => {
    const model = createModelForRole(mockConfig, "reviewer", {
      apiKeys: { anthropic: "sk-ant", openai: "sk-oa", openrouter: "sk-or" },
    });
    // reviewer uses openai/gpt-5.4 → should auto-detect as responses
    expect((model as any).npm).toBe("openai-responses");
  });

  it("uses .chat() for gpt-4o (auto-detect)", () => {
    const gpt4Config = {
      ...mockConfig,
      roles: {
        ...mockConfig.roles,
        "reviewer": { ...mockConfig.roles["reviewer"], primaryModel: "openai/gpt-4o", resolvedProvider: "openai" },
      },
    };
    const model = createModelForRole(gpt4Config, "reviewer", {
      apiKeys: { anthropic: "sk-ant", openai: "sk-oa", openrouter: "sk-or" },
    });
    // gpt-4o → should auto-detect as chat
    expect((model as any).npm).toBe("openai-chat");
  });

  it("respects explicit variant override", () => {
    const configWithVariant = {
      ...mockConfig,
      providers: [
        ...mockConfig.providers.filter(p => p.provider !== "openai"),
        {
          provider: "openai",
          npm: "@ai-sdk/openai" as const,
          secretRef: "OPENAI_API_KEY",
          enabled: true,
          capabilities: [] as never[],
          models: { "gpt-5.4": { name: "GPT-5.4", variant: "chat" as const } },
        },
      ],
    };
    const model = createModelForRole(configWithVariant, "reviewer", {
      apiKeys: { anthropic: "sk-ant", openai: "sk-oa", openrouter: "sk-or" },
    });
    // explicit variant: chat overrides auto-detect
    expect((model as any).npm).toBe("openai-chat");
  });
```

Note: The mock for `@ai-sdk/openai` already returns different values for `fn()` vs `fn.responses()`:
- `fn(modelId)` → `{ modelId, npm: "openai-chat" }`
- `fn.responses(modelId)` → `{ modelId, npm: "openai-responses" }`

- [ ] **Step 2: Run tests**

Run: `pnpm -w test -- --reporter=verbose packages/core/src/providers/__tests__/model-factory.test.ts`
Expected: All pass including new tests

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/providers/__tests__/model-factory.test.ts
git commit -m "test(providers): verify protocol auto-detection (gpt-5+ → responses) and variant override"
```

---

### Task 4: Clean up generateViaStream

**Files:**
- Modify: `packages/core/src/utils/generate-via-stream.ts`

- [ ] **Step 1: Remove store:true hack**

Replace the entire function body back to a pure wrapper:

```typescript
export async function generateViaStream(
  params: StreamTextParams,
): Promise<GenerateViaStreamResult> {
  const stream = streamText(params);

  const text = await stream.text;
  const finishReason = (await stream.finishReason) ?? "stop";
  const usage = (await stream.usage) ?? {};
  const toolCalls = (await stream.toolCalls) ?? [];
  const toolResults = (await stream.toolResults) ?? [];
  const steps = (await stream.steps) ?? [];

  return { text, finishReason, usage, toolCalls, toolResults, steps };
}
```

- [ ] **Step 2: Run full test suite**

Run: `pnpm -w test`
Expected: All pass

- [ ] **Step 3: Rebuild dist**

Run: `pnpm --filter @reporead/core build && pnpm --filter @reporead/cli build`

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/utils/generate-via-stream.ts
git commit -m "refactor(stream): remove store:true hack — protocol selection now handled by model factory"
```

---

### Task 5: Update hermes-agent config

**Files:**
- Modify: `/Users/jyxc-dz-0100318/open_source/hermes-agent/.reporead/projects/hermes-agent/config.json`

- [ ] **Step 1: Add variant to gpt-5.4 model config**

In the `kingxliu-openai` provider's models section, gpt-5.4 will auto-detect as `responses` (no explicit variant needed). But if the user wants to force `chat`, they can add `"variant": "chat"`.

No config change needed — auto-detection handles gpt-5.4 → responses.

- [ ] **Step 2: Verify by running**

Run: `cd /Users/jyxc-dz-0100318/open_source/hermes-agent && repo-read generate --debug`

Check debug log: the URL for gpt-5.4 requests should be `/v1/responses`, not `/v1/chat/completions`.

---

## Execution Order

All tasks are sequential: 1 → 2 → 3 → 4 → 5.

**Estimated total: ~45 minutes**
