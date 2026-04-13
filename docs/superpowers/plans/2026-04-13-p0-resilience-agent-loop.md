# P0 韧性增强与自管理 Agent Loop 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 RepoRead 从 AI SDK 托管 agent loop 切换到自管理 agent loop，并加入 SSE 超时保护、API 重试和 token 追踪。

**Architecture:** 自底向上构建 4 个模块：resilient-fetch（SSE 超时）→ api-retry（错误分类+重试）→ usage-tracker（token 追踪）→ agent-loop（核心循环），然后逐个迁移 9 个调用方，最后接入 pipeline 和 CLI 展示。

**Tech Stack:** TypeScript, AI SDK v6 (`ai` package), `streamText`, Vitest

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `packages/core/src/utils/resilient-fetch.ts` | SSE 流式响应超时保护 |
| `packages/core/src/utils/api-retry.ts` | API 错误分类 + 指数退避重试 |
| `packages/core/src/utils/usage-tracker.ts` | 按 role/model 的 token 累计追踪 |
| `packages/core/src/agent/agent-loop.ts` | 自管理 agent loop 核心 |
| `packages/core/src/agent/__tests__/agent-loop.test.ts` | agent loop 单元测试 |
| `packages/core/src/utils/__tests__/api-retry.test.ts` | 重试逻辑单元测试 |
| `packages/core/src/utils/__tests__/resilient-fetch.test.ts` | SSE 超时单元测试 |
| `packages/core/src/utils/__tests__/usage-tracker.test.ts` | token 追踪单元测试 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `packages/core/src/providers/model-factory.ts` | 注入 resilient-fetch |
| `packages/core/src/utils/generate-via-stream.ts` | 降级为单步薄包装 |
| `packages/core/src/catalog/catalog-planner.ts` | 迁移到 runAgentLoop |
| `packages/core/src/generation/page-drafter.ts` | 迁移到 runAgentLoop |
| `packages/core/src/generation/fork-worker.ts` | 迁移到 runAgentLoop |
| `packages/core/src/generation/evidence-planner.ts` | 迁移到 runAgentLoop |
| `packages/core/src/generation/outline-planner.ts` | 迁移到 runAgentLoop |
| `packages/core/src/review/reviewer.ts` | 迁移到 runAgentLoop |
| `packages/core/src/research/research-planner.ts` | 迁移到 runAgentLoop |
| `packages/core/src/research/research-executor.ts` | 迁移到 runAgentLoop |
| `packages/core/src/ask/ask-stream.ts` | 迁移到 runAgentLoopStream |
| `packages/core/src/generation/generation-pipeline.ts` | 接入 UsageTracker |
| `packages/cli/src/commands/generate.tsx` | 传递 tracker，展示 token 用量 |
| `packages/cli/src/progress-renderer.tsx` | 添加 token 用量到 printSummary |
| `packages/core/src/index.ts` | 导出新模块 |

---

### Task 1: SSE 超时保护 — resilient-fetch

**Files:**
- Create: `packages/core/src/utils/resilient-fetch.ts`
- Test: `packages/core/src/utils/__tests__/resilient-fetch.test.ts`

- [ ] **Step 1: 写失败测试 — SSE 超时触发**

```typescript
// packages/core/src/utils/__tests__/resilient-fetch.test.ts
import { describe, it, expect } from "vitest";
import { createResilientFetch, SSETimeoutError } from "../resilient-fetch.js";

describe("createResilientFetch", () => {
  it("throws SSETimeoutError when SSE stream stalls", async () => {
    // Mock fetch that returns a stream which never sends data after first chunk
    const stalling = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: hello\n\n"));
        // Never enqueue again — simulates stall
      },
    });

    const mockFetch = async () =>
      new Response(stalling, {
        headers: { "content-type": "text/event-stream" },
      });

    const fetch = createResilientFetch(mockFetch as typeof globalThis.fetch, {
      sseReadTimeoutMs: 100, // 100ms for test speed
    });

    const res = await fetch("http://test");
    const reader = res.body!.getReader();

    // First read succeeds
    const first = await reader.read();
    expect(first.done).toBe(false);

    // Second read should timeout
    await expect(reader.read()).rejects.toThrow(SSETimeoutError);
  });

  it("passes through non-streaming responses unchanged", async () => {
    const mockFetch = async () =>
      new Response('{"ok":true}', {
        headers: { "content-type": "application/json" },
      });

    const fetch = createResilientFetch(mockFetch as typeof globalThis.fetch);
    const res = await fetch("http://test");
    const body = await res.text();
    expect(body).toBe('{"ok":true}');
  });

  it("does not timeout when data flows normally", async () => {
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode("data: a\n\n"));
        await new Promise((r) => setTimeout(r, 30));
        controller.enqueue(new TextEncoder().encode("data: b\n\n"));
        controller.close();
      },
    });

    const mockFetch = async () =>
      new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      });

    const fetch = createResilientFetch(mockFetch as typeof globalThis.fetch, {
      sseReadTimeoutMs: 200,
    });

    const res = await fetch("http://test");
    const text = await res.text();
    expect(text).toContain("data: a");
    expect(text).toContain("data: b");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && npx vitest run src/utils/__tests__/resilient-fetch.test.ts`
Expected: FAIL — `createResilientFetch` not found

- [ ] **Step 3: 实现 resilient-fetch**

```typescript
// packages/core/src/utils/resilient-fetch.ts

const DEFAULT_SSE_TIMEOUT_MS = 120_000; // 2 minutes

export class SSETimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`SSE stream stalled: no data received for ${timeoutMs}ms`);
    this.name = "SSETimeoutError";
  }
}

export function createResilientFetch(
  baseFetch: typeof globalThis.fetch,
  options?: { sseReadTimeoutMs?: number },
): typeof globalThis.fetch {
  const timeoutMs = options?.sseReadTimeoutMs ?? DEFAULT_SSE_TIMEOUT_MS;

  return async (input, init) => {
    const response = await baseFetch(input, init);
    const contentType = response.headers.get("content-type") ?? "";
    const isStreaming =
      contentType.includes("event-stream") || contentType.includes("stream");

    if (!isStreaming || !response.body) {
      return response;
    }

    const reader = response.body.getReader();
    const wrappedBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new SSETimeoutError(timeoutMs)),
              timeoutMs,
            );
          }),
        ]);

        if (result.done) {
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      },
      cancel() {
        reader.cancel();
      },
    });

    return new Response(wrappedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && npx vitest run src/utils/__tests__/resilient-fetch.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/utils/resilient-fetch.ts packages/core/src/utils/__tests__/resilient-fetch.test.ts
git commit -m "feat: add SSE timeout protection via resilient-fetch wrapper"
```

---

### Task 2: API 错误分类 + 重试 — api-retry

**Files:**
- Create: `packages/core/src/utils/api-retry.ts`
- Test: `packages/core/src/utils/__tests__/api-retry.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/core/src/utils/__tests__/api-retry.test.ts
import { describe, it, expect, vi } from "vitest";
import { classifyApiError, withRetry } from "../api-retry.js";
import { SSETimeoutError } from "../resilient-fetch.js";

describe("classifyApiError", () => {
  it("classifies 429 as rate_limit and retryable", () => {
    const error = Object.assign(new Error("rate limited"), {
      statusCode: 429,
      responseHeaders: { "retry-after": "2" },
    });
    const result = classifyApiError(error);
    expect(result.kind).toBe("rate_limit");
    expect(result.retryable).toBe(true);
    expect(result.retryAfterMs).toBe(2000);
  });

  it("classifies 529 as server_overload and retryable", () => {
    const error = Object.assign(new Error("overloaded"), { statusCode: 529 });
    const result = classifyApiError(error);
    expect(result.kind).toBe("server_overload");
    expect(result.retryable).toBe(true);
  });

  it("classifies 401 as auth_error and not retryable", () => {
    const error = Object.assign(new Error("unauthorized"), { statusCode: 401 });
    const result = classifyApiError(error);
    expect(result.kind).toBe("auth_error");
    expect(result.retryable).toBe(false);
  });

  it("classifies context overflow as not retryable", () => {
    const error = Object.assign(new Error("prompt is too long: 200000 > 128000"), {
      statusCode: 400,
      responseBody: '{"error":{"message":"prompt is too long"}}',
    });
    const result = classifyApiError(error);
    expect(result.kind).toBe("context_overflow");
    expect(result.retryable).toBe(false);
  });

  it("classifies SSETimeoutError as timeout and retryable", () => {
    const error = new SSETimeoutError(120000);
    const result = classifyApiError(error);
    expect(result.kind).toBe("timeout");
    expect(result.retryable).toBe(true);
  });
});

describe("withRetry", () => {
  it("succeeds on first try", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable error and succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("overloaded"), { statusCode: 503 }))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(
      Object.assign(new Error("unauthorized"), { statusCode: 401 }),
    );
    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 10 })).rejects.toThrow("unauthorized");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxRetries", async () => {
    const fn = vi.fn().mockRejectedValue(
      Object.assign(new Error("overloaded"), { statusCode: 503 }),
    );
    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 10 })).rejects.toThrow("overloaded");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("respects retry-after header", async () => {
    const start = Date.now();
    const fn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("rate limited"), {
        statusCode: 429,
        responseHeaders: { "retry-after-ms": "50" },
      }))
      .mockResolvedValue("ok");
    await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(40); // ~50ms wait
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && npx vitest run src/utils/__tests__/api-retry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 api-retry**

```typescript
// packages/core/src/utils/api-retry.ts
import { SSETimeoutError } from "./resilient-fetch.js";

export type ApiErrorKind =
  | "rate_limit"
  | "server_overload"
  | "server_error"
  | "context_overflow"
  | "auth_error"
  | "bad_request"
  | "timeout"
  | "unknown";

export type ApiErrorClassification = {
  kind: ApiErrorKind;
  retryable: boolean;
  retryAfterMs?: number;
};

function parseRetryAfter(error: unknown): number | undefined {
  const headers =
    (error as { responseHeaders?: Record<string, string> }).responseHeaders ?? {};

  // retry-after-ms takes priority (milliseconds)
  const msHeader = headers["retry-after-ms"];
  if (msHeader) {
    const ms = Number(msHeader);
    if (!isNaN(ms) && ms > 0) return ms;
  }

  // retry-after (seconds)
  const secHeader = headers["retry-after"];
  if (secHeader) {
    const sec = Number(secHeader);
    if (!isNaN(sec) && sec > 0) return sec * 1000;
  }

  return undefined;
}

const CONTEXT_OVERFLOW_PATTERNS = [
  /prompt is too long/i,
  /context_length_exceeded/i,
  /maximum context length/i,
];

export function classifyApiError(error: unknown): ApiErrorClassification {
  if (error instanceof SSETimeoutError) {
    return { kind: "timeout", retryable: true };
  }

  const statusCode = (error as { statusCode?: number }).statusCode;
  const message = error instanceof Error ? error.message : String(error);
  const responseBody =
    (error as { responseBody?: string }).responseBody ?? "";

  if (statusCode === 429) {
    return {
      kind: "rate_limit",
      retryable: true,
      retryAfterMs: parseRetryAfter(error),
    };
  }

  if (statusCode === 529 || statusCode === 503) {
    return { kind: "server_overload", retryable: true };
  }

  if (statusCode === 500 || statusCode === 502) {
    return { kind: "server_error", retryable: true };
  }

  if (statusCode === 401 || statusCode === 403) {
    return { kind: "auth_error", retryable: false };
  }

  if (statusCode === 400) {
    const text = message + responseBody;
    for (const pattern of CONTEXT_OVERFLOW_PATTERNS) {
      if (pattern.test(text)) {
        return { kind: "context_overflow", retryable: false };
      }
    }
    return { kind: "bad_request", retryable: false };
  }

  return { kind: "unknown", retryable: false };
}

export type RetryOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
  backoffFactor?: number;
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelay = options?.baseDelayMs ?? 1000;
  const factor = options?.backoffFactor ?? 2;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const classification = classifyApiError(error);

      if (!classification.retryable || attempt === maxRetries) {
        throw error;
      }

      const delay =
        classification.retryAfterMs ?? baseDelay * Math.pow(factor, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && npx vitest run src/utils/__tests__/api-retry.test.ts`
Expected: 10 tests PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/utils/api-retry.ts packages/core/src/utils/__tests__/api-retry.test.ts
git commit -m "feat: add API error classification and retry with exponential backoff"
```

---

### Task 3: Token 追踪 — usage-tracker

**Files:**
- Create: `packages/core/src/utils/usage-tracker.ts`
- Test: `packages/core/src/utils/__tests__/usage-tracker.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/core/src/utils/__tests__/usage-tracker.test.ts
import { describe, it, expect } from "vitest";
import { UsageTracker } from "../usage-tracker.js";

describe("UsageTracker", () => {
  it("accumulates tokens by role and model", () => {
    const tracker = new UsageTracker();
    tracker.add("drafter", "gpt-5.4", {
      inputTokens: 1000,
      outputTokens: 200,
      reasoningTokens: 50,
      cachedTokens: 800,
    });
    tracker.add("drafter", "gpt-5.4", {
      inputTokens: 2000,
      outputTokens: 300,
      reasoningTokens: 100,
      cachedTokens: 1500,
    });
    tracker.add("worker", "MiniMax-M2.7-highspeed", {
      inputTokens: 500,
      outputTokens: 100,
      reasoningTokens: 0,
      cachedTokens: 0,
    });

    const usage = tracker.getUsage();

    expect(usage.byRole["drafter"].inputTokens).toBe(3000);
    expect(usage.byRole["drafter"].requests).toBe(2);
    expect(usage.byRole["worker"].inputTokens).toBe(500);
    expect(usage.byModel["gpt-5.4"].outputTokens).toBe(500);
    expect(usage.byModel["MiniMax-M2.7-highspeed"].requests).toBe(1);
    expect(usage.total.inputTokens).toBe(3500);
    expect(usage.total.cachedTokens).toBe(2300);
    expect(usage.total.requests).toBe(3);
  });

  it("starts empty", () => {
    const tracker = new UsageTracker();
    const usage = tracker.getUsage();
    expect(usage.total.inputTokens).toBe(0);
    expect(usage.total.requests).toBe(0);
    expect(Object.keys(usage.byRole)).toHaveLength(0);
    expect(Object.keys(usage.byModel)).toHaveLength(0);
  });

  it("serializes to JSON", () => {
    const tracker = new UsageTracker();
    tracker.add("catalog", "gpt-5.4", {
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 10,
      cachedTokens: 0,
    });
    const json = JSON.parse(tracker.toJSON());
    expect(json.total.inputTokens).toBe(100);
    expect(json.byRole.catalog.outputTokens).toBe(50);
    expect(json.byModel["gpt-5.4"].reasoningTokens).toBe(10);
  });

  it("formats display string", () => {
    const tracker = new UsageTracker();
    tracker.add("drafter", "gpt-5.4", {
      inputTokens: 2572615,
      outputTokens: 43304,
      reasoningTokens: 22183,
      cachedTokens: 1100416,
    });
    tracker.add("worker", "MiniMax", {
      inputTokens: 467416,
      outputTokens: 46155,
      reasoningTokens: 0,
      cachedTokens: 0,
    });

    const display = tracker.formatDisplay();
    expect(display).toContain("gpt-5.4");
    expect(display).toContain("MiniMax");
    expect(display).toContain("2,572,615");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && npx vitest run src/utils/__tests__/usage-tracker.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 usage-tracker**

```typescript
// packages/core/src/utils/usage-tracker.ts

export type UsageInput = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
};

export type UsageBucket = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  requests: number;
};

export type JobUsage = {
  byRole: Record<string, UsageBucket>;
  byModel: Record<string, UsageBucket>;
  total: UsageBucket;
};

function emptyBucket(): UsageBucket {
  return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, requests: 0 };
}

function addToBucket(bucket: UsageBucket, input: UsageInput): void {
  bucket.inputTokens += input.inputTokens;
  bucket.outputTokens += input.outputTokens;
  bucket.reasoningTokens += input.reasoningTokens;
  bucket.cachedTokens += input.cachedTokens;
  bucket.requests += 1;
}

export class UsageTracker {
  private byRole: Record<string, UsageBucket> = {};
  private byModel: Record<string, UsageBucket> = {};
  private total: UsageBucket = emptyBucket();

  add(role: string, model: string, usage: UsageInput): void {
    if (!this.byRole[role]) this.byRole[role] = emptyBucket();
    if (!this.byModel[model]) this.byModel[model] = emptyBucket();

    addToBucket(this.byRole[role], usage);
    addToBucket(this.byModel[model], usage);
    addToBucket(this.total, usage);
  }

  getUsage(): JobUsage {
    return {
      byRole: { ...this.byRole },
      byModel: { ...this.byModel },
      total: { ...this.total },
    };
  }

  toJSON(): string {
    return JSON.stringify(this.getUsage(), null, 2);
  }

  formatDisplay(): string {
    const fmt = (n: number) => n.toLocaleString("en-US");
    const lines: string[] = ["  Token 用量:"];
    for (const [model, b] of Object.entries(this.byModel)) {
      const parts = [`input=${fmt(b.inputTokens)}`, `output=${fmt(b.outputTokens)}`];
      if (b.reasoningTokens > 0) parts.push(`reasoning=${fmt(b.reasoningTokens)}`);
      if (b.cachedTokens > 0) parts.push(`cached=${fmt(b.cachedTokens)}`);
      lines.push(`    ${model}:  ${parts.join("  ")}  (${b.requests} reqs)`);
    }
    const t = this.total;
    const totalParts = [`input=${fmt(t.inputTokens)}`, `output=${fmt(t.outputTokens)}`];
    if (t.reasoningTokens > 0) totalParts.push(`reasoning=${fmt(t.reasoningTokens)}`);
    if (t.cachedTokens > 0) totalParts.push(`cached=${fmt(t.cachedTokens)}`);
    lines.push(`    总计:  ${totalParts.join("  ")}  (${t.requests} reqs)`);
    return lines.join("\n");
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && npx vitest run src/utils/__tests__/usage-tracker.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/utils/usage-tracker.ts packages/core/src/utils/__tests__/usage-tracker.test.ts
git commit -m "feat: add UsageTracker for per-role/model token accounting"
```

---

### Task 4: 自管理 Agent Loop 核心

**Files:**
- Create: `packages/core/src/agent/agent-loop.ts`
- Test: `packages/core/src/agent/__tests__/agent-loop.test.ts`

- [ ] **Step 1: 写失败测试 — 基本 loop 执行**

```typescript
// packages/core/src/agent/__tests__/agent-loop.test.ts
import { describe, it, expect, vi } from "vitest";
import { runAgentLoop } from "../agent-loop.js";
import type { AgentLoopOptions, StepInfo } from "../agent-loop.js";

// Mock model that returns text without tool calls
function mockModel(responses: Array<{ text: string; toolCalls?: Array<{ name: string; args: Record<string, unknown> }> }>) {
  let callIndex = 0;
  return {
    provider: "mock",
    modelId: "mock-model",
    // streamText will be mocked at module level
    _responses: responses,
    _callIndex: () => callIndex++,
  };
}

// We need to mock the streamText import
vi.mock("ai", () => ({
  streamText: vi.fn(),
}));

import { streamText } from "ai";
const mockStreamText = vi.mocked(streamText);

function setupMockStream(responses: Array<{
  text: string;
  finishReason?: string;
  toolCalls?: Array<{ toolCallType: "function"; toolCallId: string; toolName: string; args: Record<string, unknown> }>;
  usage?: { promptTokens: number; completionTokens: number };
}>) {
  let callIdx = 0;
  mockStreamText.mockImplementation(() => {
    const resp = responses[callIdx++] ?? responses[responses.length - 1];
    return {
      text: Promise.resolve(resp.text),
      finishReason: Promise.resolve(resp.finishReason ?? "stop"),
      usage: Promise.resolve(resp.usage ?? { promptTokens: 100, completionTokens: 50 }),
      toolCalls: Promise.resolve(resp.toolCalls ?? []),
      toolResults: Promise.resolve([]),
      steps: Promise.resolve([]),
      fullStream: (async function* () {
        yield { type: "text-delta" as const, textDelta: resp.text };
      })(),
    } as any;
  });
}

describe("runAgentLoop", () => {
  it("returns text when model responds without tool calls", async () => {
    setupMockStream([{ text: "Hello world", finishReason: "stop" }]);

    const result = await runAgentLoop(
      {
        model: { provider: "mock", modelId: "test" } as any,
        system: "You are helpful",
        tools: {},
        maxSteps: 10,
      },
      "Say hello",
    );

    expect(result.text).toBe("Hello world");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].finishReason).toBe("stop");
  });

  it("executes tool calls and continues loop", async () => {
    setupMockStream([
      {
        text: "",
        finishReason: "tool-calls",
        toolCalls: [{ toolCallType: "function", toolCallId: "call_1", toolName: "greet", args: { name: "World" } }],
      },
      { text: "Done greeting", finishReason: "stop" },
    ]);

    const tools = {
      greet: {
        description: "Greet someone",
        parameters: { type: "object", properties: { name: { type: "string" } } },
        execute: async ({ name }: { name: string }) => `Hello ${name}!`,
      },
    };

    const result = await runAgentLoop(
      {
        model: { provider: "mock", modelId: "test" } as any,
        system: "You are helpful",
        tools: tools as any,
        maxSteps: 10,
      },
      "Greet World",
    );

    expect(result.text).toBe("Done greeting");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].toolCalls).toHaveLength(1);
    expect(result.steps[0].toolCalls[0].name).toBe("greet");
  });

  it("stops at maxSteps", async () => {
    // Always returns tool calls, never stops
    setupMockStream([
      {
        text: "",
        finishReason: "tool-calls",
        toolCalls: [{ toolCallType: "function", toolCallId: "call_1", toolName: "noop", args: {} }],
      },
    ]);

    const tools = {
      noop: {
        description: "Do nothing",
        parameters: { type: "object", properties: {} },
        execute: async () => "done",
      },
    };

    const result = await runAgentLoop(
      {
        model: { provider: "mock", modelId: "test" } as any,
        system: "You are helpful",
        tools: tools as any,
        maxSteps: 3,
      },
      "Loop forever",
    );

    expect(result.steps).toHaveLength(3);
  });

  it("calls onStep callback for each step", async () => {
    setupMockStream([
      {
        text: "",
        finishReason: "tool-calls",
        toolCalls: [{ toolCallType: "function", toolCallId: "call_1", toolName: "noop", args: {} }],
        usage: { promptTokens: 200, completionTokens: 50 },
      },
      { text: "done", finishReason: "stop", usage: { promptTokens: 300, completionTokens: 80 } },
    ]);

    const tools = {
      noop: {
        description: "noop",
        parameters: { type: "object", properties: {} },
        execute: async () => "ok",
      },
    };

    const steps: StepInfo[] = [];
    await runAgentLoop(
      {
        model: { provider: "mock", modelId: "test" } as any,
        system: "test",
        tools: tools as any,
        maxSteps: 10,
        onStep: (step) => steps.push(step),
      },
      "test",
    );

    expect(steps).toHaveLength(2);
    expect(steps[0].stepIndex).toBe(0);
    expect(steps[0].inputTokens).toBe(200);
    expect(steps[1].stepIndex).toBe(1);
    expect(steps[1].finishReason).toBe("stop");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && npx vitest run src/agent/__tests__/agent-loop.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 agent-loop**

```typescript
// packages/core/src/agent/agent-loop.ts
import { streamText } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import { withRetry } from "../utils/api-retry.js";
import { buildResponsesProviderOptions } from "../utils/generate-via-stream.js";
import type { UsageInput } from "../utils/usage-tracker.js";

export type StepInfo = {
  stepIndex: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  toolCalls: Array<{ name: string; args: unknown }>;
  finishReason: string;
};

export type AgentLoopOptions = {
  model: LanguageModel;
  system: string;
  tools: ToolSet;
  maxSteps: number;
  maxInputTokens?: number;
  onStep?: (step: StepInfo) => void;
};

type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCallRecord[] }
  | { role: "tool"; toolCallId: string; toolName: string; result: string };

type ToolCallRecord = {
  toolCallType: "function";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

export type AgentLoopResult = {
  text: string;
  messages: Message[];
  totalUsage: UsageInput;
  steps: StepInfo[];
};

function extractUsage(usage: Record<string, unknown>): {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
} {
  const input = Number(usage.promptTokens ?? usage.inputTokens ?? usage.input_tokens ?? 0);
  const output = Number(usage.completionTokens ?? usage.outputTokens ?? usage.output_tokens ?? 0);

  const outputDetails = (usage.outputTokensDetails ?? usage.output_tokens_details ?? {}) as Record<string, unknown>;
  const reasoning = Number(outputDetails.reasoningTokens ?? outputDetails.reasoning_tokens ?? 0);

  const inputDetails = (usage.inputTokensDetails ?? usage.input_tokens_details ?? usage.promptTokensDetails ?? usage.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const cached = Number(inputDetails.cachedTokens ?? inputDetails.cached_tokens ?? 0);

  return { inputTokens: input, outputTokens: output, reasoningTokens: reasoning, cachedTokens: cached };
}

export async function runAgentLoop(
  options: AgentLoopOptions,
  initialPrompt: string,
): Promise<AgentLoopResult> {
  const { model, system, tools, maxSteps, onStep } = options;
  const messages: Message[] = [{ role: "user", content: initialPrompt }];
  const steps: StepInfo[] = [];
  const totalUsage: UsageInput = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
  let lastText = "";

  // Build provider-specific options (Responses API: store, instructions, reasoning, etc.)
  const responsesOpts = buildResponsesProviderOptions(model);

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    // Build messages for AI SDK format
    const aiMessages = messages.map((m) => {
      if (m.role === "user") return { role: "user" as const, content: m.content };
      if (m.role === "tool") return { role: "tool" as const, content: m.result, toolCallId: m.toolCallId };
      // assistant
      const parts: unknown[] = [];
      if (m.content) parts.push({ type: "text", text: m.content });
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          parts.push({ type: "tool-call", toolCallId: tc.toolCallId, toolName: tc.toolName, args: tc.args });
        }
      }
      return { role: "assistant" as const, content: parts };
    });

    // Build streamText params
    let streamParams: Record<string, unknown> = {
      model,
      system,
      messages: aiMessages,
      tools,
    };

    // Apply Responses API options
    if (responsesOpts) {
      const openaiOpts = { ...(responsesOpts.providerOptions.openai as Record<string, unknown>) };
      if (responsesOpts.stripSystem && system) {
        openaiOpts.instructions = system;
        streamParams.system = undefined;
      }
      streamParams.providerOptions = { openai: openaiOpts };
    }

    // Call streamText with retry
    const stream = await withRetry(
      () => {
        const s = streamText(streamParams as any);
        return Promise.resolve(s);
      },
      { maxRetries: 3 },
    );

    const text = await (stream as any).text;
    const finishReason: string = (await (stream as any).finishReason) ?? "stop";
    const usage: Record<string, unknown> = (await (stream as any).usage) ?? {};
    const toolCalls: ToolCallRecord[] = (await (stream as any).toolCalls) ?? [];

    // Extract and accumulate usage
    const stepUsage = extractUsage(usage);
    totalUsage.inputTokens += stepUsage.inputTokens;
    totalUsage.outputTokens += stepUsage.outputTokens;
    totalUsage.reasoningTokens += stepUsage.reasoningTokens;
    totalUsage.cachedTokens += stepUsage.cachedTokens;

    // Build step info
    const stepInfo: StepInfo = {
      stepIndex,
      ...stepUsage,
      toolCalls: toolCalls.map((tc) => ({ name: tc.toolName, args: tc.args })),
      finishReason,
    };
    steps.push(stepInfo);
    onStep?.(stepInfo);

    if (text) lastText = text;

    // No tool calls → done
    if (!toolCalls.length || finishReason === "stop") {
      break;
    }

    // Append assistant message with tool calls
    messages.push({ role: "assistant", content: text, toolCalls });

    // Execute tools
    for (const tc of toolCalls) {
      const toolDef = (tools as Record<string, { execute?: (args: unknown) => Promise<string> | string }>)[tc.toolName];
      let result: string;
      try {
        result = toolDef?.execute
          ? String(await toolDef.execute(tc.args))
          : `Error: Unknown tool "${tc.toolName}"`;
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      messages.push({ role: "tool", toolCallId: tc.toolCallId, toolName: tc.toolName, result });
    }
  }

  return { text: lastText, messages, totalUsage, steps };
}

// ── Streaming variant for Ask ──

export type AgentLoopEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; name: string; args: unknown }
  | { type: "tool-result"; name: string; output: string }
  | { type: "step-done"; step: StepInfo }
  | { type: "done"; result: AgentLoopResult };

export async function* runAgentLoopStream(
  options: AgentLoopOptions,
  initialPrompt: string,
): AsyncGenerator<AgentLoopEvent> {
  const { model, system, tools, maxSteps, onStep } = options;
  const messages: Message[] = [{ role: "user", content: initialPrompt }];
  const steps: StepInfo[] = [];
  const totalUsage: UsageInput = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
  let lastText = "";

  const responsesOpts = buildResponsesProviderOptions(model);

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    const aiMessages = messages.map((m) => {
      if (m.role === "user") return { role: "user" as const, content: m.content };
      if (m.role === "tool") return { role: "tool" as const, content: m.result, toolCallId: m.toolCallId };
      const parts: unknown[] = [];
      if (m.content) parts.push({ type: "text", text: m.content });
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          parts.push({ type: "tool-call", toolCallId: tc.toolCallId, toolName: tc.toolName, args: tc.args });
        }
      }
      return { role: "assistant" as const, content: parts };
    });

    let streamParams: Record<string, unknown> = { model, system, messages: aiMessages, tools };
    if (responsesOpts) {
      const openaiOpts = { ...(responsesOpts.providerOptions.openai as Record<string, unknown>) };
      if (responsesOpts.stripSystem && system) {
        openaiOpts.instructions = system;
        streamParams.system = undefined;
      }
      streamParams.providerOptions = { openai: openaiOpts };
    }

    const stream = await withRetry(() => Promise.resolve(streamText(streamParams as any)), { maxRetries: 3 });

    // Stream deltas
    let stepText = "";
    const toolCalls: ToolCallRecord[] = [];

    for await (const part of (stream as any).fullStream) {
      switch (part.type) {
        case "text-delta":
          stepText += part.textDelta ?? "";
          yield { type: "text-delta", text: part.textDelta ?? "" };
          break;
        case "reasoning-delta":
          yield { type: "reasoning-delta", text: (part as { textDelta?: string }).textDelta ?? "" };
          break;
        case "tool-call":
          toolCalls.push({
            toolCallType: "function",
            toolCallId: (part as any).toolCallId,
            toolName: (part as any).toolName,
            args: (part as any).args,
          });
          yield { type: "tool-call", name: (part as any).toolName, args: (part as any).args };
          break;
      }
    }

    const finishReason: string = (await (stream as any).finishReason) ?? "stop";
    const usage: Record<string, unknown> = (await (stream as any).usage) ?? {};
    const stepUsage = extractUsage(usage);
    totalUsage.inputTokens += stepUsage.inputTokens;
    totalUsage.outputTokens += stepUsage.outputTokens;
    totalUsage.reasoningTokens += stepUsage.reasoningTokens;
    totalUsage.cachedTokens += stepUsage.cachedTokens;

    const stepInfo: StepInfo = {
      stepIndex, ...stepUsage,
      toolCalls: toolCalls.map((tc) => ({ name: tc.toolName, args: tc.args })),
      finishReason,
    };
    steps.push(stepInfo);
    onStep?.(stepInfo);
    yield { type: "step-done", step: stepInfo };

    if (stepText) lastText = stepText;

    if (!toolCalls.length || finishReason === "stop") break;

    messages.push({ role: "assistant", content: stepText, toolCalls });

    for (const tc of toolCalls) {
      const toolDef = (tools as Record<string, { execute?: (args: unknown) => Promise<string> | string }>)[tc.toolName];
      let result: string;
      try {
        result = toolDef?.execute ? String(await toolDef.execute(tc.args)) : `Error: Unknown tool "${tc.toolName}"`;
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      messages.push({ role: "tool", toolCallId: tc.toolCallId, toolName: tc.toolName, result });
      yield { type: "tool-result", name: tc.toolName, output: result };
    }
  }

  yield { type: "done", result: { text: lastText, messages, totalUsage, steps } };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && npx vitest run src/agent/__tests__/agent-loop.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/agent/agent-loop.ts packages/core/src/agent/__tests__/agent-loop.test.ts
git commit -m "feat: self-managed agent loop with retry, usage tracking, and streaming variant"
```

---

### Task 5: 注入 resilient-fetch 到 model-factory

**Files:**
- Modify: `packages/core/src/providers/model-factory.ts`

- [ ] **Step 1: 修改 model-factory 导入并组合 fetch 链**

在 `model-factory.ts` 中，将 `createResilientFetch` 注入到所有 provider 的 fetch 链中。

当前代码（`createModel` 函数中 OpenAI 分支）：

```typescript
const baseFetch = fetchFn ?? globalThis.fetch;
const fetchWithSession: typeof globalThis.fetch = (input, init) => { ... };
```

改为在文件顶部导入：

```typescript
import { createResilientFetch } from "../utils/resilient-fetch.js";
```

然后在 `createModelForRole` 中组合 fetch 链：

```typescript
const debugFetchFn = getDebugDir() ? createDebugFetch() : undefined;
const baseFetch = createResilientFetch(debugFetchFn ?? globalThis.fetch);
return createModel(npm, resolvedProviderName, modelName, apiKey, providerConfig?.baseUrl, baseFetch, modelConfig?.variant);
```

对 `createModel` 的三个 SDK 分支，都使用传入的 `fetchFn`（现在已经包含 resilient-fetch 层）：

- `@ai-sdk/anthropic`: `{ ...authOpts, fetch: fetchFn }`
- `@ai-sdk/openai`: `fetchWithSession` 基于 `fetchFn`（已在当前代码中）
- `@ai-sdk/openai-compatible`: `{ fetch: fetchFn }`

- [ ] **Step 2: 运行 build 确认编译通过**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/providers/model-factory.ts
git commit -m "feat: inject resilient-fetch into all provider fetch chains"
```

---

### Task 6: 迁移 CatalogPlanner 到 runAgentLoop

**Files:**
- Modify: `packages/core/src/catalog/catalog-planner.ts`

- [ ] **Step 1: 修改导入和调用**

当前代码：

```typescript
import { stepCountIs } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import { generateViaStream as generateText } from "../utils/generate-via-stream.js";
```

改为：

```typescript
import type { LanguageModel, ToolSet } from "ai";
import { runAgentLoop } from "../agent/agent-loop.js";
import type { StepInfo } from "../agent/agent-loop.js";
```

当前 generateText 调用：

```typescript
const result = await generateText({
  model: this.model,
  system: systemPrompt,
  prompt: userPrompt,
  tools: tools as unknown as ToolSet,
  stopWhen: stepCountIs(this.maxSteps),
});
```

改为：

```typescript
const result = await runAgentLoop(
  {
    model: this.model,
    system: systemPrompt,
    tools: tools as unknown as ToolSet,
    maxSteps: this.maxSteps,
    onStep: this.onStep,
  },
  userPrompt,
);
```

在 `CatalogPlannerOptions` 类型中添加可选的 `onStep` 回调：

```typescript
export type CatalogPlannerOptions = {
  model: LanguageModel;
  language: string;
  maxSteps?: number;
  onStep?: (step: StepInfo) => void;
};
```

结果使用保持不变 — `result.text` 和 `result.totalUsage` 即可。

- [ ] **Step 2: 运行 build 确认编译通过**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/catalog/catalog-planner.ts
git commit -m "refactor: migrate CatalogPlanner to self-managed agent loop"
```

---

### Task 7: 迁移 PageDrafter 到 runAgentLoop

**Files:**
- Modify: `packages/core/src/generation/page-drafter.ts`

- [ ] **Step 1: 修改导入和调用**

当前导入改为：

```typescript
import type { LanguageModel, ToolSet } from "ai";
import { runAgentLoop } from "../agent/agent-loop.js";
import type { StepInfo } from "../agent/agent-loop.js";
```

当前调用：

```typescript
const result = await generateText({
  model: this.model,
  system: systemPrompt,
  prompt: userPrompt,
  tools: tools as unknown as ToolSet,
  stopWhen: stepCountIs(this.maxSteps),
  maxOutputTokens: this.maxOutputTokens,
});
```

改为：

```typescript
const result = await runAgentLoop(
  {
    model: this.model,
    system: systemPrompt,
    tools: tools as unknown as ToolSet,
    maxSteps: this.maxSteps,
    onStep: this.onStep,
  },
  userPrompt,
);
```

注意：`maxOutputTokens` 不再传递（之前已因代理兼容问题在 `generateViaStream` 中剥离了）。

结果使用：`result.text` 保持不变。`result.finishReason` 改为从 `result.steps` 的最后一步取：

```typescript
const lastStep = result.steps[result.steps.length - 1];
const finishReason = lastStep?.finishReason;
if (finishReason === "length") {
  parsed.truncated = true;
}
```

在 `PageDrafterOptions` 中添加 `onStep`：

```typescript
export type PageDrafterOptions = {
  model: LanguageModel;
  repoRoot: string;
  maxSteps?: number;
  maxOutputTokens?: number;
  onStep?: (step: StepInfo) => void;
};
```

- [ ] **Step 2: 运行 build 确认编译通过**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/generation/page-drafter.ts
git commit -m "refactor: migrate PageDrafter to self-managed agent loop"
```

---

### Task 8: 迁移 ForkWorker, EvidencePlanner, OutlinePlanner

**Files:**
- Modify: `packages/core/src/generation/fork-worker.ts`
- Modify: `packages/core/src/generation/evidence-planner.ts`
- Modify: `packages/core/src/generation/outline-planner.ts`

- [ ] **Step 1: 迁移 ForkWorker**

导入改为：

```typescript
import type { LanguageModel, ToolSet } from "ai";
import { runAgentLoop } from "../agent/agent-loop.js";
```

调用改为：

```typescript
const result = await runAgentLoop(
  {
    model: this.model,
    system: systemPrompt,
    tools: tools as unknown as ToolSet,
    maxSteps: this.maxSteps,
  },
  userPrompt,
);
```

结果使用不变：`result.text`。

- [ ] **Step 2: 迁移 EvidencePlanner**

EvidencePlanner 不使用 tools 和 stepCountIs，只是单步调用。改为：

```typescript
import type { LanguageModel } from "ai";
import { runAgentLoop } from "../agent/agent-loop.js";
```

```typescript
const result = await runAgentLoop(
  {
    model: this.model,
    system: systemPrompt,
    tools: {},
    maxSteps: 1,
  },
  userPrompt,
);
```

- [ ] **Step 3: 迁移 OutlinePlanner**

同 EvidencePlanner 模式：

```typescript
import type { LanguageModel } from "ai";
import { runAgentLoop } from "../agent/agent-loop.js";
```

```typescript
const result = await runAgentLoop(
  {
    model: this.model,
    system: systemPrompt,
    tools: {},
    maxSteps: 1,
  },
  userPrompt,
);
```

- [ ] **Step 4: 运行 build 确认编译通过**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/generation/fork-worker.ts packages/core/src/generation/evidence-planner.ts packages/core/src/generation/outline-planner.ts
git commit -m "refactor: migrate ForkWorker, EvidencePlanner, OutlinePlanner to agent loop"
```

---

### Task 9: 迁移 FreshReviewer

**Files:**
- Modify: `packages/core/src/review/reviewer.ts`

- [ ] **Step 1: 修改导入和调用**

```typescript
import type { LanguageModel, ToolSet } from "ai";
import { runAgentLoop } from "../agent/agent-loop.js";
```

```typescript
const result = await runAgentLoop(
  {
    model: this.model,
    system: systemPrompt,
    tools: tools as unknown as ToolSet,
    maxSteps: this.maxSteps,
  },
  userPrompt,
);
```

结果使用不变：`result.text`。

- [ ] **Step 2: 运行 build 确认编译通过**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/review/reviewer.ts
git commit -m "refactor: migrate FreshReviewer to self-managed agent loop"
```

---

### Task 10: 迁移 ResearchPlanner + ResearchExecutor

**Files:**
- Modify: `packages/core/src/research/research-planner.ts`
- Modify: `packages/core/src/research/research-executor.ts`

- [ ] **Step 1: 迁移 ResearchPlanner**

```typescript
import type { LanguageModel, ToolSet } from "ai";
import { runAgentLoop } from "../agent/agent-loop.js";
```

```typescript
const result = await runAgentLoop(
  {
    model: this.options.model,
    system: `You are a research planner...`,
    tools: tools as unknown as ToolSet,
    maxSteps: this.maxSteps,
  },
  `Research topic: ${topic}...`,
);
```

- [ ] **Step 2: 迁移 ResearchExecutor**

```typescript
import type { LanguageModel, ToolSet } from "ai";
import { runAgentLoop } from "../agent/agent-loop.js";
```

```typescript
const result = await runAgentLoop(
  {
    model: this.options.model,
    system: `You are a focused code investigator...`,
    tools: tools as unknown as ToolSet,
    maxSteps: this.maxSteps,
  },
  `Investigate: ${question}...`,
);
```

- [ ] **Step 3: 运行 build 确认编译通过**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/research/research-planner.ts packages/core/src/research/research-executor.ts
git commit -m "refactor: migrate ResearchPlanner and ResearchExecutor to agent loop"
```

---

### Task 11: 迁移 AskStreamService 到 runAgentLoopStream

**Files:**
- Modify: `packages/core/src/ask/ask-stream.ts`

- [ ] **Step 1: 修改导入**

移除：

```typescript
import { streamText, stepCountIs } from "ai";
import { buildResponsesProviderOptions } from "../utils/generate-via-stream.js";
```

改为：

```typescript
import { runAgentLoopStream } from "../agent/agent-loop.js";
import type { AgentLoopEvent } from "../agent/agent-loop.js";
```

- [ ] **Step 2: 修改 runStreamingRoute 方法**

当前 `runStreamingRoute` 中手动调用 `streamText` 并遍历 `fullStream`。替换为：

```typescript
private async *runStreamingRoute(
  route: AskRoute,
  question: string,
  pageContent: string,
  wiki: WikiJson | null,
  sessionId: string,
  turns: Array<{ role: string; content: string }>,
): AsyncGenerator<AskStreamEvent> {
  const systemPrompt = this.buildSystemPrompt(route);
  const userPrompt = this.buildUserPrompt(question, pageContent, wiki, turns);

  const profileAskBudget = this.qualityProfile?.askMaxSteps ?? 10;
  const isPageFirst = route === "page-first";
  const budget = isPageFirst ? 2 : profileAskBudget;
  const toolSet = isPageFirst
    ? {}
    : createCatalogTools(this.repoRoot);

  let fullText = "";
  const citations: CitationRecord[] = [];

  for await (const event of runAgentLoopStream(
    {
      model: this.model,
      system: systemPrompt,
      tools: toolSet as any,
      maxSteps: budget,
    },
    userPrompt,
  )) {
    switch (event.type) {
      case "text-delta":
        fullText += event.text;
        yield { type: "text-delta", text: event.text };
        break;
      case "reasoning-delta":
        yield { type: "reasoning-delta", text: event.text };
        break;
      case "tool-call":
        yield { type: "tool-call", toolName: event.name, input: event.args };
        break;
      case "tool-result":
        yield { type: "tool-result", toolName: event.name };
        break;
      case "done":
        break;
    }
  }

  const parsed = this.parseCitations(fullText);
  const cleanAnswer = this.sanitizeAnswer(parsed.answer);
  citations.push(...parsed.citations);

  this.sessionManager.addAssistantTurn(sessionId, cleanAnswer, citations);
  await this.sessionManager.persist(sessionId);

  yield { type: "citations", citations };
  yield { type: "done" };
}
```

- [ ] **Step 3: 运行 build 确认编译通过**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/ask/ask-stream.ts
git commit -m "refactor: migrate AskStreamService to runAgentLoopStream"
```

---

### Task 12: 接入 UsageTracker 到 Pipeline + CLI 展示

**Files:**
- Modify: `packages/core/src/generation/generation-pipeline.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/cli/src/commands/generate.tsx`
- Modify: `packages/cli/src/progress-renderer.tsx`

- [ ] **Step 1: Pipeline 创建并传递 UsageTracker**

在 `generation-pipeline.ts` 中：

导入：

```typescript
import { UsageTracker } from "../utils/usage-tracker.js";
```

在 `GenerationPipelineOptions` 中添加：

```typescript
export type GenerationPipelineOptions = {
  // ...existing fields...
  usageTracker?: UsageTracker;
};
```

在 `GenerationPipeline` 类中保存：

```typescript
private readonly usageTracker: UsageTracker;

constructor(options: GenerationPipelineOptions) {
  // ...existing...
  this.usageTracker = options.usageTracker ?? new UsageTracker();
}
```

在创建每个 agent（CatalogPlanner, PageDrafter, FreshReviewer 等）时传 `onStep` 回调：

```typescript
// 例如 CatalogPlanner
const catalogPlanner = new CatalogPlanner({
  model: this.catalogModel,
  language: this.config.language,
  maxSteps: this.config.qualityProfile.catalogMaxSteps,
  onStep: (step) => this.usageTracker.add("catalog", (this.catalogModel as any).modelId ?? "unknown", step),
});
```

对每个 role 类似处理，role 参数为 "catalog" / "outline" / "drafter" / "worker" / "reviewer"。

Pipeline 结束时（`run()` 方法最后）写入 usage.json：

```typescript
const usagePath = this.storage.paths.jobDir(slug, jobId) + "/usage.json";
await fs.writeFile(usagePath, this.usageTracker.toJSON(), "utf-8");
```

在 `PipelineResult` 中添加 tracker 引用：

```typescript
export type PipelineResult = {
  success: boolean;
  job: GenerationJob;
  error?: string;
  usageTracker?: UsageTracker;
};
```

返回时附上：

```typescript
return { success: true, job, usageTracker: this.usageTracker };
```

- [ ] **Step 2: 导出新模块**

在 `packages/core/src/index.ts` 中添加：

```typescript
export { UsageTracker } from "./utils/usage-tracker.js";
export type { UsageBucket, UsageInput, JobUsage } from "./utils/usage-tracker.js";
export { runAgentLoop, runAgentLoopStream } from "./agent/agent-loop.js";
export type { AgentLoopOptions, AgentLoopResult, AgentLoopEvent, StepInfo } from "./agent/agent-loop.js";
```

- [ ] **Step 3: CLI generate 命令传入 tracker 并展示**

在 `packages/cli/src/commands/generate.tsx` 中：

导入：

```typescript
import { UsageTracker } from "@reporead/core";
```

创建 tracker 并传入 pipeline：

```typescript
const usageTracker = new UsageTracker();

const pipeline = new GenerationPipeline({
  // ...existing options...
  usageTracker,
});
```

在 `printSummary` 调用后展示 token 用量：

```typescript
renderer.printSummary(pipelineResult.success, job);
if (pipelineResult.usageTracker) {
  console.log(pipelineResult.usageTracker.formatDisplay());
  console.log();
}
```

- [ ] **Step 4: 运行 build 确认编译通过**

Run: `cd packages/core && npx tsc --noEmit && cd ../cli && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/generation/generation-pipeline.ts packages/core/src/index.ts packages/cli/src/commands/generate.tsx
git commit -m "feat: wire UsageTracker into pipeline and CLI display"
```

---

### Task 13: 清理 generateViaStream + 移除旧依赖

**Files:**
- Modify: `packages/core/src/utils/generate-via-stream.ts`
- Modify: `packages/core/src/generation/generation-pipeline.ts`

- [ ] **Step 1: 简化 generateViaStream**

`generateViaStream.ts` 不再被任何调用方直接使用（都迁移到了 `runAgentLoop`）。保留 `buildResponsesProviderOptions`（被 agent-loop 使用），移除 `generateViaStream` 函数、`setCacheKey`、`setModelOptions` 等全局状态。

将 `cacheKey` 和 `currentModelOptions` 的管理移到 `agent-loop.ts` 中（或保留为共享状态，agent-loop 已经通过 `buildResponsesProviderOptions` 读取）。

最简方案：保留 `generate-via-stream.ts` 中的 `setCacheKey`、`getCacheKey`、`setModelOptions`、`buildResponsesProviderOptions`，删除 `generateViaStream` 函数本身。

- [ ] **Step 2: 移除 pipeline 中的 `setModelReasoning` / `setModelOptions` 调用**

当前 pipeline 在每个阶段前调用 `setModelOptions(getModelOptionsForRole(...))`。这个机制仍然需要保留（agent-loop 内部通过 `buildResponsesProviderOptions` 读取 `currentModelOptions`）。所以这些调用保持不变。

- [ ] **Step 3: 运行全量测试**

Run: `cd packages/core && npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: 运行 build**

Run: `pnpm --filter @reporead/core build && pnpm --filter @reporead/cli build`
Expected: No errors

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/utils/generate-via-stream.ts
git commit -m "refactor: simplify generate-via-stream, remove unused generateViaStream function"
```

---

### Task 14: 端到端验证

- [ ] **Step 1: 运行全量单元测试**

Run: `cd packages/core && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: 编译两个包**

Run: `pnpm --filter @reporead/core build && pnpm --filter @reporead/cli build`
Expected: No errors

- [ ] **Step 3: 验证 debug 模式能正常工作**

Run: `REPOREAD_DEBUG=1 repo-read generate --debug` (对一个小仓库)
验证：
- debug 日志正常写入
- SSE 超时不误触发（正常请求不超时）
- Token 用量在结束时显示
- 生成流程完整跑通（catalog → evidence → outline → draft → review → publish）

- [ ] **Step 4: 提交最终状态**

```bash
git add -A
git commit -m "feat: P0 complete — self-managed agent loop with retry, timeout, and usage tracking"
```
