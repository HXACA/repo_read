# RepoRead 韧性增强与自管理 Agent Loop 设计

> 基于 Codex / Claude Code / OpenCode 全面对比分析，将 RepoRead 从"AI SDK 托管 loop + 无重试 + 无超时"升级为"自管理 agent loop + 分层韧性 + 可观测"的架构。

## 背景

当前 RepoRead 的 agent loop 委托给 AI SDK 的 `streamText` + `stepCountIs`，存在三个严重问题：

1. **SSE 断线无感知**：连接断开后 promise 永久 hang，已观察到 8 小时卡死（job `02342c18`，请求 `17:15:10`）
2. **无 API 重试**：429/5xx 直接失败，整页生成中止
3. **消息历史不可控**：SDK 内部管理消息，无法做压缩、裁剪、注入、token 检查

## 优先级与模块清单

### P0 — 立即实施

| 模块 | 文件 | 职责 |
|------|------|------|
| 自管理 Agent Loop | `agent/agent-loop.ts` | 替代 AI SDK 托管 loop，自己管理消息历史、工具执行、循环控制 |
| API 错误分类 + 重试 | `utils/api-retry.ts` | 对 429/529/5xx 指数退避重试，解析 retry-after header |
| SSE 超时保护 | `utils/resilient-fetch.ts` | 流式响应 2 分钟无数据自动 abort |
| Token 追踪 | `utils/usage-tracker.ts` | 按 role/model 累计 token，job 结束持久化 + CLI 展示 |

### P1 — 短期实施

| 模块 | 位置 | 职责 |
|------|------|------|
| Anthropic 缓存控制 | agent-loop 内 | 对 Anthropic 协议模型注入 `cacheControl: { type: "ephemeral" }` |
| 缓存破坏检测 | agent-loop 内 | hash(instructions + tools)，变化时写 warning 到 debug log |

### P2 — 中期实施

| 模块 | 文件 | 职责 |
|------|------|------|
| Provider 注册表 | `providers/model-factory.ts` | switch-case → map 查表 |
| Provider Transform Pipeline | `utils/provider-transforms.ts` | 按 provider 类型执行消息转换链 |
| 上下文压缩 | agent-loop 内 | 消息历史超阈值时压缩成结构化摘要 |

### 依赖关系

```
P0-Agent Loop 是核心，P0-Retry/Timeout/Tracking 在其内部生效
P1 依赖 P0 Agent Loop 的 loop 结构
P2-压缩 依赖 P0 Agent Loop 的消息管理能力
P2-Provider 注册表/Transform 独立，可并行
```

---

## P0-4：自管理 Agent Loop

### 设计目标

替代 AI SDK 的 `streamText` + `stepCountIs` 托管 loop。自己管理消息历史，每步调一次 `streamText`（单步，不带 agent loop），手动处理 tool call → tool result → 下一步。

### 接口

```typescript
// agent/agent-loop.ts

type AgentLoopOptions = {
  model: LanguageModel;
  system: string;
  tools: ToolSet;
  maxSteps: number;
  maxInputTokens?: number;          // P2 压缩阈值，P0 先不用
  onStep?: (step: StepInfo) => void; // 每步回调（token 追踪、进度）
};

type StepInfo = {
  stepIndex: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  toolCalls: Array<{ name: string; args: unknown }>;
  finishReason: string;
};

type AgentLoopResult = {
  text: string;                     // 最终文本输出
  messages: Message[];              // 完整消息历史
  totalUsage: UsageBucket;          // 累计 token
  steps: StepInfo[];                // 每步详情
};

async function runAgentLoop(
  options: AgentLoopOptions,
  initialPrompt: string,
): Promise<AgentLoopResult>;
```

### 内部循环

```
1. messages = [{ role: "user", content: initialPrompt }]
2. for step in 0..maxSteps:
   a. [P2] 如果 maxInputTokens 设置且消息估算 token 超阈值 → 压缩
   b. [P1] 首步：hash(system + tools)，检测 cache break
   c. 构建 streamText 参数，应用 provider transforms
   d. 用 withRetry 包住 streamText 调用（单步，无 agent loop）
   e. 等待完成，提取 text + toolCalls + usage
   f. 回调 onStep(stepInfo)
   g. 如果无 toolCalls（finishReason === "stop"）→ 结束
   h. 追加 assistant message（含 toolCalls）到 messages
   i. 并行/串行执行工具，收集 results
   j. 追加 tool result messages 到 messages
   k. 继续下一步
3. 返回 { text, messages, totalUsage, steps }
```

### 流式变体（Ask 用）

```typescript
async function* runAgentLoopStream(
  options: AgentLoopOptions,
  initialPrompt: string,
): AsyncGenerator<AgentLoopEvent>;

type AgentLoopEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; name: string; args: unknown }
  | { type: "tool-result"; name: string; output: string }
  | { type: "step-done"; step: StepInfo }
  | { type: "done"; result: AgentLoopResult };
```

### 替换清单

| 调用方 | 文件 | 当前方式 | 改为 |
|--------|------|---------|------|
| CatalogPlanner | `catalog/catalog-planner.ts` | `generateText` + `stepCountIs` | `runAgentLoop` |
| PageDrafter | `generation/page-drafter.ts` | `generateText` + `stepCountIs` | `runAgentLoop` |
| ForkWorker | `generation/fork-worker.ts` | `generateText` + `stepCountIs` | `runAgentLoop` |
| EvidencePlanner | `generation/evidence-planner.ts` | `generateText` + `stepCountIs` | `runAgentLoop` |
| OutlinePlanner | `generation/outline-planner.ts` | `generateText` + `stepCountIs` | `runAgentLoop` |
| FreshReviewer | `review/reviewer.ts` | `generateText` + `stepCountIs` | `runAgentLoop` |
| ResearchPlanner | `research/research-planner.ts` | `generateText` + `stepCountIs` | `runAgentLoop` |
| ResearchExecutor | `research/research-executor.ts` | `generateText` + `stepCountIs` | `runAgentLoop` |
| AskStreamService | `ask/ask-stream.ts` | 原生 `streamText` | `runAgentLoopStream` |

### `generateViaStream` 的命运

`generateViaStream.ts` 降级为薄包装 — 只负责单步 `streamText` 调用 + provider options 注入。不再有 agent loop 语义。`runAgentLoop` 在内部调用它。

---

## P0-1：API 错误分类 + 重试

### 文件

`packages/core/src/utils/api-retry.ts`

### 错误分类

```typescript
type ApiErrorKind =
  | "rate_limit"        // 429
  | "server_overload"   // 529, 503
  | "server_error"      // 500, 502
  | "context_overflow"  // 400 + "prompt is too long" / "context_length_exceeded"
  | "auth_error"        // 401, 403
  | "bad_request"       // 400 其他
  | "timeout"           // SSE 超时（来自 resilient-fetch）
  | "unknown";

function classifyApiError(error: unknown): {
  kind: ApiErrorKind;
  retryable: boolean;
  retryAfterMs?: number;
};
```

### 重试逻辑

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options?: { maxRetries?: number },  // 默认 3
): Promise<T>;
```

- 初始延迟 1000ms，退避因子 2x
- 优先使用 `retry-after` / `retry-after-ms` header
- `context_overflow`、`auth_error`、`bad_request` 不重试
- `timeout` 可重试（SSE 断线恢复）
- 从 AI SDK 的 `AIAPICallError` 提取 `statusCode` 和 `responseBody`

### 集成点

在 `runAgentLoop` 的每步 streamText 调用外包 `withRetry`。

---

## P0-2：SSE 超时保护

### 文件

`packages/core/src/utils/resilient-fetch.ts`

### 实现

```typescript
function createResilientFetch(
  baseFetch: typeof globalThis.fetch,
  options?: { sseReadTimeoutMs?: number },  // 默认 120_000
): typeof globalThis.fetch;
```

工作方式：
1. 代理 `baseFetch` 调用
2. 检查响应 `Content-Type` 是否包含 `text/event-stream` 或 `stream`
3. 如果是流式响应，用 `ReadableStream` 包装 `response.body`
4. 每次 `reader.read()` 设 `setTimeout`，超过 `sseReadTimeoutMs` 无数据到达 → abort
5. 抛出带 `timeout` 标记的错误，被 `withRetry` 捕获后重试

### 注入方式

在 `model-factory.ts` 创建 provider 时组合：

```
resilientFetch(debugFetch(globalThis.fetch))
```

非 debug 模式：

```
resilientFetch(globalThis.fetch)
```

---

## P0-3：Token 追踪

### 文件

`packages/core/src/utils/usage-tracker.ts`

### 数据结构

```typescript
type UsageBucket = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  requests: number;
};

type JobUsage = {
  byRole: Record<string, UsageBucket>;
  byModel: Record<string, UsageBucket>;
  total: UsageBucket;
};

class UsageTracker {
  add(role: string, model: string, usage: StepInfo): void;
  getUsage(): JobUsage;
  toJSON(): string;
}
```

### 采集

- `runAgentLoop` 的 `onStep` 回调中调用 `tracker.add()`
- 处理 Anthropic 字段名差异（`prompt_tokens` / `input_tokens`，`completion_tokens` / `output_tokens`）

### 输出

- Pipeline 结束时：`tracker.toJSON()` → `{jobDir}/usage.json`
- CLI `printSummary`：读取 tracker 展示每个模型的 token 分布

```
  Token 用量:
    gpt-5.4:   input=2,572,615  output=43,304  reasoning=22,183  cached=1,100,416
    MiniMax:   input=467,416    output=46,155   reasoning=0       cached=0
    glm-5.1:   input=1,160,674  output=7,597    reasoning=0       cached=850,560
    总计:      input=4,200,705  output=97,056   reasoning=22,183  cached=1,950,976
```

---

## P1-5：Anthropic 协议缓存控制

在 `runAgentLoop` 内部，当检测到模型 provider 为 Anthropic 时，通过 `providerOptions` 注入：

```typescript
providerOptions: {
  anthropic: {
    cacheControl: { type: "ephemeral" },
  },
}
```

应用到 system 消息和最近的用户消息上，让 Anthropic 服务端缓存这些前缀。

---

## P1-6：缓存破坏检测

在 `runAgentLoop` 的首步，对 `system + JSON.stringify(tools)` 做简单字符串 hash，与上一次调用的 hash 比较。变化时写 warning 到 pipeline debug log：

```
[cache-break] prefix hash changed: 8332 → 2649, previous cache invalidated
```

仅记录，不阻断。全局变量 `lastPrefixHash` 保存上次 hash。

---

## P2-7：Provider 注册表

重构 `model-factory.ts`，用 `PROVIDER_REGISTRY: Record<string, ProviderFactory>` 替代 switch-case。

```typescript
type ProviderFactory = (config: {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: typeof globalThis.fetch;
}) => (modelId: string, variant?: string) => LanguageModel;

const PROVIDER_REGISTRY: Record<string, ProviderFactory> = {
  "@ai-sdk/anthropic": (config) => { ... },
  "@ai-sdk/openai": (config) => { ... },
  "@ai-sdk/openai-compatible": (config) => { ... },
};
```

新增 provider 只需往 map 加一条。

---

## P2-8：Provider Transform Pipeline

新文件 `utils/provider-transforms.ts`，定义 per-provider 的参数转换链：

```typescript
type TransformFn = (params: StreamTextParams) => StreamTextParams;

const TRANSFORMS: Record<string, TransformFn[]> = {
  "openai.responses": [
    stripSystemToInstructions,
    stripMaxOutputTokens,
    injectStoreAndCacheKey,
    injectReasoningOptions,
  ],
  "anthropic": [
    injectCacheControl,
  ],
};
```

在 agent-loop 每步 streamText 前执行。`generateViaStream` 中散落的 if/else 逻辑迁移到这里。

---

## P2-9：上下文压缩

依赖 P0-4 自管理 Agent Loop 的消息管理能力。

在 loop 内每步开始前，估算 `messages` 的 token 数（用字符数 / 4 粗估，或用 `usage.inputTokens` 从上一步返回值）。超过 `maxInputTokens` 时：

1. 取当前 `messages` 全文
2. 调一次 LLM，system prompt 为压缩指令，user prompt 为消息历史
3. 返回结构化摘要：

```markdown
## Goal
{当前任务目标}
## Discoveries
{已发现的关键信息}
## Accomplished
{已完成的步骤}
## Relevant Files
{涉及的文件列表}
```

4. 用摘要消息替换 `messages` 中除最后一条 user 消息外的全部历史
5. 继续 loop

默认 `maxInputTokens` 不设置（不压缩）。只有 CatalogPlanner 等长 loop 场景按需配置（如 150,000）。

---

## 测试策略

| 模块 | 测试要点 |
|------|---------|
| Agent Loop | 基本 loop 执行、tool call → result → 续轮、maxSteps 停止、finishReason="stop" 停止 |
| API 重试 | 429 重试成功、500 重试成功、401 不重试、context_overflow 不重试、retry-after 解析 |
| SSE 超时 | 模拟流式响应中断 → 超时触发 → 错误可被 withRetry 捕获 |
| Token 追踪 | 多步累加正确、byRole/byModel 分桶正确、JSON 序列化 |
| 缓存检测 | hash 变化触发 warning、hash 不变无 warning |
| 调用方迁移 | 每个替换的调用方跑一次端到端，输出与之前一致 |
