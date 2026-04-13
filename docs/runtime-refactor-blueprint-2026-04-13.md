# RepoRead Runtime 重构蓝图

> 时间：2026-04-13  
> 状态：架构蓝图，待按阶段执行  
> 关联文档：
> - [docs/coding-agent-design-comparison-2026-04-13.md](./coding-agent-design-comparison-2026-04-13.md)
> - [docs/agent-architecture.md](./agent-architecture.md)
> - [docs/architecture-optimization-2026-04-12.md](./architecture-optimization-2026-04-12.md)

---

## 0. 这份文档要解决什么

这不是功能规划文档，而是 **运行时分层蓝图**。

它回答四个问题：

1. RepoRead 当前真正的架构问题是什么。
2. 目标层次应该怎么划分。
3. 现有文件分别应该落到哪一层。
4. 这次重构应该按什么顺序做，每一步以什么为完成标准。

一句话总结：

> RepoRead 现在的核心问题不是缺功能，而是业务编排层吞掉了运行时控制平面。

---

## 1. 问题诊断

### 1.1 当前最核心的结构性问题

当前 `packages/core/src/generation/generation-pipeline.ts` 实际上同时承担了五类职责：

1. 业务编排  
   例：`catalog -> page -> review -> publish`
2. 运行时驱动  
   例：决定何时 draft、何时 retry、何时重新收集 evidence
3. 模型调用策略  
   例：`setCacheKey()`、`setModelOptions()`、动态 step 预算、质量档位调节
4. 中间产物持久化  
   例：evidence、outline、draft、review、validation、published index
5. 反馈闭环  
   例：reviewer verdict 折返、truncation guard、revision context 注入

这意味着：

- `generation-pipeline.ts` 不是纯 pipeline，它已经变成半个 runtime。
- `agent-loop.ts` 虽然是通用 loop，但当前只像一个被调用的“循环函数”，不是系统运行时中心。
- `ask` 和 `research` 两条链各自又重新接了一套轻量逻辑，没能共享 generation 已经长出来的 runtime 能力。

### 1.2 当前代码味道的本质

如果只看最近暴露的问题：

- cache 不稳定
- prompt 不统一
- retry 位置分散
- tool message 语义容易错
- path policy 临时补丁化

它们看起来像五个独立 bug，但底层其实都指向同一个根因：

> `turn policy`、`prompt assembly`、`provider call state`、`tool execution semantics`、`context shaping` 没有独立归位。

### 1.3 当前结构示意

```text
generation-pipeline.ts
  ├── 直接决定 page flow
  ├── 直接 new drafter / reviewer / coordinator
  ├── 直接 setCacheKey / setModelOptions
  ├── 直接写 evidence / outline / draft / review / validation 文件
  ├── 直接处理 reviewer feedback loop
  └── 直接处理 truncation / retry

ask-service.ts / ask-stream.ts
  ├── 自己决定 route
  ├── 自己拼 prompt
  ├── 自己决定 recent turns
  └── 直接调 runAgentLoop / runAgentLoopStream

research-service.ts / planner.ts / executor.ts
  ├── 自己拼 prompt
  ├── 自己调 runAgentLoop
  └── 自己组织 persistence
```

这三个入口唯一共同点只是都“调用了 loop”，而不是都“运行在同一个 runtime 上”。

---

## 2. 目标架构

### 2.1 目标原则

重构后必须满足四个原则：

1. **业务流程不拥有运行时细节**
2. **prompt 组装不拥有业务流程**
3. **上下文治理不散落在各 service**
4. **中间产物路径不裸露到业务逻辑**

### 2.2 目标层次

RepoRead 应收敛为六层：

```text
1. Product Flows
   - GenerationFlow
   - AskFlow
   - ResearchFlow

2. Turn Runtime
   - TurnEngine
   - TurnPolicy
   - RetryPolicy
   - ToolBatchPolicy
   - OverflowPolicy

3. Prompt Layer
   - PromptAssembler
   - Role prompt sections
   - Mode-specific context adapters

4. Context Layer
   - ConversationContextManager
   - ContextCompactor
   - Turn history / replay baseline

5. Artifact Layer
   - ArtifactStore
   - Draft / review / validation / evidence / outline / ask / research IO

6. Infra Layer
   - ToolRegistry
   - Provider runtime / model routing
   - Config resolver
   - Event bus / usage tracking
```

### 2.3 每层职责

#### 1. Product Flows

只回答“业务上下一步做什么”，不回答“这一步怎么跑”。

例如：

- `GenerationFlow`：先 catalog，再按页面循环 evidence -> outline -> draft -> review -> publish
- `AskFlow`：分类为 `page-first` / `page-plus-retrieval` / `research`
- `ResearchFlow`：plan -> execute -> synthesize -> persist

它们不应该：

- 手动切 model options
- 直接组织 retry while-loop
- 直接写路径字符串
- 直接拼完整 prompt

#### 2. Turn Runtime

这是重构后的核心。

它负责：

- 单轮执行
- 工具调用循环
- retry
- usage 汇总
- tool batch 策略
- overflow / truncation / compact hook
- provider call context

它不负责：

- catalog/page/ask/research 的业务语义
- artifact 路径组织
- prompt 文案本身

#### 3. Prompt Layer

负责把：

- role
- mode
- conversation context
- artifact refs
- tool exposure
- language
- policy

装配成结构化 prompt 输入。

它不负责：

- 调模型
- 跑工具
- 持久化

#### 4. Context Layer

负责两类上下文：

1. **对话型上下文**
   - ask / research 的 turn history
   - replay baseline
   - compact summary
2. **运行时消费视图**
   - 当前 turn 该看到哪些历史
   - 哪些 tool outputs 要外置或裁剪

注意：generation 的 evidence / outline / review 文件不属于这个层，它们属于 Artifact Layer。

#### 5. Artifact Layer

负责：

- typed path API
- typed read/write API
- 对 draft/review/validation/evidence/outline/research/ask session 的命名与布局负责

这层要把 `StoragePaths` 从“路径拼接工具”升级成“领域化存储接口”。

#### 6. Infra Layer

负责：

- provider routing
- tool registry
- config resolution
- usage/event plumbing

这层不直接知道 GenerationFlow/AskFlow/ResearchFlow 的业务语义。

---

## 3. 建议的目标目录形态

不是要求一次性挪完，而是作为重构终态。

```text
packages/core/src/
  runtime/
    turn-engine.ts
    turn-types.ts
    retry-policy.ts
    tool-batch.ts
    overflow-policy.ts
    model-call.ts

  prompt/
    assembler.ts
    sections/
      base.ts
      tools.ts
      language.ts
      artifacts.ts
    roles/
      drafter.ts
      reviewer.ts
      worker.ts
      ask.ts
      research.ts

  context/
    conversation-context-manager.ts
    context-compactor.ts
    context-window.ts

  artifacts/
    artifact-store.ts
    paths.ts
    generation-artifacts.ts
    ask-artifacts.ts
    research-artifacts.ts

  flows/
    generation/
      generation-flow.ts
      page-workflow.ts
      review-workflow.ts
    ask/
      ask-flow.ts
      ask-stream-flow.ts
    research/
      research-flow.ts

  tools/
    registry.ts
    tool-profile.ts
    ...

  providers/
    provider-registry.ts
    model-routing.ts
    model-options.ts

  config/
    schema.ts
    resolver.ts
    layer-stack.ts
```

注意：这是目标层次，不是要求第一阶段就做物理迁移。第一阶段允许先用 facade 文件和 adapter 保持兼容。

---

## 4. 现有文件到目标层次的映射

### 4.1 必须重点拆分的文件

| 当前文件 | 当前职责 | 目标层次 | 重构动作 |
| --- | --- | --- | --- |
| `packages/core/src/generation/generation-pipeline.ts` | 业务编排 + runtime + retry + persistence + review 折返 | `flows/generation` + `runtime` + `artifacts` | 拆成 `GenerationFlow`、`PageWorkflow`、`ReviewWorkflow` |
| `packages/core/src/agent/agent-loop.ts` | 通用 loop 函数 | `runtime/turn-engine.ts` 的核心执行器 | 保留为底层 executor，但不再被业务层直接调用 |
| `packages/core/src/utils/generate-via-stream.ts` | 全局 cacheKey / modelOptions 状态 | `runtime/model-call.ts` 或 `providers/model-options.ts` | 取消全局 setter，改显式 request-scoped 参数 |
| `packages/core/src/ask/ask-service.ts` | route + prompt + loop + persistence | `flows/ask/ask-flow.ts` + `prompt` + `context` + `artifacts` | 只保留业务路由与结果整合 |
| `packages/core/src/ask/ask-stream.ts` | route + prompt + stream loop | `flows/ask/ask-stream-flow.ts` + `runtime` | 与 AskFlow 共享 TurnEngine |
| `packages/core/src/research/research-service.ts` | 流程编排 + synthesis + persistence | `flows/research/research-flow.ts` + `artifacts` | 流程保留，执行细节下沉 |
| `packages/core/src/research/research-planner.ts` | prompt + loop | `prompt/roles/research.ts` + `runtime` | 不再直接调底层 loop |
| `packages/core/src/research/research-executor.ts` | prompt + loop | `prompt/roles/research.ts` + `runtime` | 不再直接调底层 loop |

## 4.2 应转为 Prompt Layer 的文件

| 当前文件 | 目标 |
| --- | --- |
| `generation/page-drafter-prompt.ts` | `prompt/roles/drafter.ts` |
| `generation/fork-worker-prompt.ts` | `prompt/roles/worker.ts` |
| `review/reviewer-prompt.ts` | `prompt/roles/reviewer.ts` |
| `catalog/catalog-prompt.ts` | `prompt/roles/catalog.ts` |
| `ask-service.ts` 内嵌 system/user prompt | `prompt/roles/ask.ts` |
| `research-planner.ts` / `research-executor.ts` 内嵌 system prompt | `prompt/roles/research.ts` |

原则：

- 这些文件以后应该只产生 prompt sections 或 role prompt spec。
- 不应该再知道 storage path、job id、model options、usage tracker。

## 4.3 应转为 Artifact Layer 的文件

| 当前文件 | 目标 |
| --- | --- |
| `storage/paths.ts` | 保留，但降为底层路径定义 |
| `storage/storage-adapter.ts` | 保留，但作为低层 IO adapter |
| `generation-pipeline.ts` 中直接 `readJson/writeJson` 的逻辑 | 移到 `artifacts/artifact-store.ts` |
| `ask/ask-session.ts` | `artifacts/ask-artifacts.ts` |
| `research/research-store.ts` | `artifacts/research-artifacts.ts` |

原则：

- 业务层不再直接拼 `draft/review/validation/evidence` 路径。
- ArtifactStore 提供 typed API，例如：
  - `saveEvidence(pageRef, evidence)`
  - `loadOutline(pageRef)`
  - `saveAskSession(session)`
  - `saveResearchNote(note)`

## 4.4 应转为 Runtime / Provider Layer 的文件

| 当前文件 | 目标 |
| --- | --- |
| `agent/agent-loop.ts` | `runtime/turn-engine.ts` 的 loop 核 |
| `utils/generate-via-stream.ts` | `runtime/model-call.ts` |
| `providers/model-factory.ts` | `providers/model-options.ts` + `providers/model-runtime.ts` |
| `providers/provider-center.ts` | `providers/provider-registry.ts` |
| `providers/model-route.ts` | `providers/model-routing.ts` |
| `utils/usage-tracker.ts` | 继续保留，但由 TurnEngine 统一驱动 |

## 4.5 暂时可以不动的文件

这些文件可以在前两阶段保持稳定：

- `generation/evidence-coordinator.ts`
- `generation/evidence-planner.ts`
- `generation/outline-planner.ts`
- `review/reviewer.ts`
- `catalog/catalog-planner.ts`
- `validation/*`

它们当前更像领域组件，不是最先要拆的控制平面。

---

## 5. 核心接口蓝图

### 5.1 Turn Engine

建议目标接口：

```ts
type TurnRequest = {
  purpose: "catalog" | "draft" | "review" | "ask" | "research-plan" | "research-exec" | "research-synthesize";
  model: LanguageModel;
  prompt: AssembledPrompt;
  tools: ToolSet;
  policy: TurnPolicy;
  context: TurnContextView;
};

type TurnPolicy = {
  maxSteps: number;
  maxOutputTokens?: number;
  retry: RetryPolicy;
  overflow: OverflowPolicy;
  toolBatch: ToolBatchPolicy;
  providerOptions?: ProviderCallOptions;
};

type TurnResult = {
  text: string;
  messages: Message[];
  usage: JobUsage;
  steps: StepInfo[];
  finishReason: string;
};
```

关键约束：

- Product Flow 只调 `TurnEngine.run(request)` 或 `TurnEngine.stream(request)`。
- Product Flow 不直接碰 `streamText` 或 `runAgentLoop`。

## 5.2 Prompt Assembler

建议目标接口：

```ts
type PromptAssemblyInput = {
  role: "catalog" | "drafter" | "worker" | "reviewer" | "ask" | "research";
  mode?: string;
  language: string;
  toolExposure: ToolExposureProfile;
  context: PromptContext;
};

type AssembledPrompt = {
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

关键约束：

- prompt 文件不再自己决定“完整 system prompt 长什么样”。
- ask/research/generation 都通过同一个 assembler 进模型。

## 5.3 Conversation Context Manager

建议目标接口：

```ts
type ConversationContextManager = {
  load(scope: ConversationScope): Promise<ConversationContextView>;
  recordTurn(scope: ConversationScope, turn: RecordedTurn): Promise<void>;
  compact(scope: ConversationScope, policy: CompactPolicy): Promise<CompactResult>;
};
```

关键约束：

- 只管理会话型上下文，不直接管理 generation artifacts。
- `AskFlow` 和 `ResearchFlow` 必须共享这层。

## 5.4 Artifact Store

建议目标接口：

```ts
type ArtifactStore = {
  generation: {
    saveEvidence(...): Promise<void>;
    loadEvidence(...): Promise<EvidenceCollectionResult | null>;
    saveOutline(...): Promise<void>;
    saveDraft(...): Promise<void>;
    saveReview(...): Promise<void>;
    saveValidation(...): Promise<void>;
  };
  ask: {
    loadSession(...): Promise<AskSession | null>;
    saveSession(...): Promise<void>;
  };
  research: {
    saveNote(...): Promise<void>;
    loadNote(...): Promise<ResearchNote | null>;
  };
};
```

关键约束：

- `StoragePaths` 不再直接暴露给业务流程。
- 所有路径规则都收口到 Artifact Store。

---

## 6. 实施顺序

### 6.1 Phase 0：先定接口，不改行为

### 目标

先把新层次的接口壳子立起来，但不改变对外行为。

### 要做的事

1. 新建以下 facade 或空实现：
   - `runtime/turn-types.ts`
   - `runtime/model-call.ts`
   - `prompt/assembler.ts`
   - `artifacts/artifact-store.ts`
2. 把 `StoragePaths` / `StorageAdapter` 接到 `ArtifactStore`
3. 把 `runAgentLoop` 包一层 `TurnEngineAdapter`

### 边界

- 不改 prompt 内容
- 不改 step budget
- 不改 evidence/review/publish 流程

### 验收条件

- 所有现有测试保持通过
- 新 facade 被 generation 链以 adapter 方式调用
- 行为没有可观察变化

### 6.2 Phase 1：去掉全局 model-call 状态

### 目标

把 `generate-via-stream.ts` 的全局 setter 语义改成显式 request-scoped 配置。

### 要做的事

1. 把 `cacheKey`、`reasoning`、`serviceTier` 变为 `ProviderCallOptions`
2. `runAgentLoop` 接收 `providerCallOptions`
3. `GenerationPipeline` / `AskFlow` / `ResearchFlow` 不再调用：
   - `setCacheKey`
   - `setModelOptions`

### 边界

- 这一步不引入新 runtime，只做参数显式化

### 验收条件

- `grep -R "setCacheKey\\|setModelOptions"` 在业务层为 0
- provider options 由调用参数决定，而不是模块级单例
- 现有 generation 行为保持一致

### 6.3 Phase 2：引入 Prompt Assembler

### 目标

把 prompt 组装从业务 service 中抽出。

### 要做的事

1. generation 的 drafter/worker/reviewer 先接入 assembler
2. ask 的 system/user prompt 改由 assembler 产出
3. research 的 planner/executor/synthesis prompt 改由 assembler 产出

### 边界

- 先不追求 prompt 文案重写
- 先做“组装位置统一”，不是“内容大改版”

### 验收条件

- `ask-service.ts`、`ask-stream.ts`、`research-*.ts` 不再内联长 system prompt 字符串
- `page-drafter-prompt.ts` 等文件变成 role section builder
- PromptAssembler 有 golden tests，覆盖 generation/ask/research 三类输入

### 6.4 Phase 3：Turn Engine 统一化

### 目标

让所有业务链不再直接调用 `runAgentLoop`。

### 要做的事

1. 引入 `TurnEngine.run()` / `TurnEngine.stream()`
2. 把 usage tracking、retry policy、tool batch policy 收进去
3. generation / ask / research 全部改调 TurnEngine

### 边界

- 先只统一 loop 调度
- compaction/overflow 先允许是 no-op policy 或轻量 policy

### 验收条件

- `grep -R "runAgentLoop\\|runAgentLoopStream"` 只剩 runtime 层和测试
- 三条业务链都只通过 TurnEngine 进入模型
- usage 统计不再由业务链手动拼接

### 6.5 Phase 4：Conversation Context Manager

### 目标

统一 ask / research 的会话上下文治理。

### 要做的事

1. 让 ask 不再硬编码“最近 4 轮”
2. 引入对话历史 compact/replay 能力
3. research plan / executor / synthesize 共享 conversation context 视图

### 边界

- generation artifacts 不并入这层
- 只管 conversation，不管 page draft artifact

### 验收条件

- AskFlow 不再直接 slice recent turns
- ResearchFlow 可读取历史研究摘要或 prior context
- context shaping 有单独测试，不再散落在 ask/research service

### 6.6 Phase 5：GenerationFlow 瘦身

### 目标

让 `generation-pipeline.ts` 退化成纯业务编排器。

### 要做的事

1. 拆出：
   - `generation-flow.ts`
   - `page-workflow.ts`
   - `review-workflow.ts`
2. pipeline 中所有直接模型调用、prompt 组装、path 操作、retry while-loop 全部下沉
3. `generation-pipeline.ts` 只保留阶段顺序与状态迁移

### 边界

- 允许先保留 event emitter 和 job manager
- 不需要这一步同时重写 evidence/reviewer 领域组件

### 验收条件

- `generation-pipeline.ts` 不再直接调用模型层 API
- `generation-pipeline.ts` 不再直接 `writeJson/readJson` 中间产物
- `generation-pipeline.ts` 行数显著下降，职责单一

---

## 7. 每阶段的“不要做什么”

### Phase 0 不要做

- 不要顺手改 prompt 文案
- 不要顺手优化 quality profile
- 不要顺手改 tool schema

### Phase 1 不要做

- 不要一边去全局状态一边引入 compact
- 不要顺手改 provider routing 规则

### Phase 2 不要做

- 不要把 prompt 重写成另一套风格
- 不要一开始就做用户可配置 prompt

### Phase 3 不要做

- 不要同时引入多客户端协议
- 不要同时把 compaction 做成复杂状态机

### Phase 4 不要做

- 不要把 generation artifacts 和 conversation history 混成一个 manager

### Phase 5 不要做

- 不要继续在 pipeline 里新增新策略开关

---

## 8. 架构验收条件

这是整个重构的最终验收标准，不是单个阶段的局部标准。

### 8.1 代码层

满足以下 grep 规则：

1. `runAgentLoop` / `runAgentLoopStream`
   - 只能在 runtime 层与测试中出现
2. `setCacheKey` / `setModelOptions`
   - 只能在兼容层或测试中出现，最终目标为删除
3. `StoragePaths`
   - 不应被 generation/ask/research flow 直接 import
4. 长 system prompt 字符串
   - 不应继续散落在 ask/research service 文件里

### 8.2 职责层

1. Product Flow 只决定业务顺序，不决定模型调用细节
2. Turn Engine 只决定 turn 执行，不拥有业务阶段知识
3. Prompt Assembler 不直接操作 storage / model options
4. Artifact Store 不承载业务逻辑
5. Conversation Context Manager 不承载 generation artifact

### 8.3 测试层

必须新增四类测试：

1. `PromptAssembler` golden tests
2. `TurnEngine` retry / tool batch / usage tests
3. `ArtifactStore` 路径与 persistence contract tests
4. `GenerationFlow` orchestration tests，依赖 fake TurnEngine + fake ArtifactStore

---

## 9. 第一批建议落地的文件

如果只做第一轮最关键的重构，建议先动这些文件：

1. `packages/core/src/utils/generate-via-stream.ts`
2. `packages/core/src/agent/agent-loop.ts`
3. `packages/core/src/generation/generation-pipeline.ts`
4. `packages/core/src/ask/ask-service.ts`
5. `packages/core/src/ask/ask-stream.ts`
6. `packages/core/src/research/research-service.ts`
7. `packages/core/src/research/research-planner.ts`
8. `packages/core/src/research/research-executor.ts`
9. `packages/core/src/storage/paths.ts`
10. `packages/core/src/storage/storage-adapter.ts`

这十个文件基本覆盖了当前的控制平面症结。

---

## 10. 这轮重构之后，RepoRead 会变成什么

重构完成后，RepoRead 的心智应该变成：

```text
Product Flows
  GenerationFlow
  AskFlow
  ResearchFlow

shared by all:
  PromptAssembler
  TurnEngine
  ConversationContextManager
  ArtifactStore
  ToolRegistry
  ProviderRegistry
```

届时：

- generation 不再是特殊系统，而只是一个使用共享 runtime 的业务流
- ask/research 不再是旁路实现，而是共享同一个 turn runtime
- cache / prompt / retry / overflow / tool batch 都有明确归属

这才是后续继续做 reviewer 增强、context compression、provider 扩展、MCP 接入的正确前提。

---

## 11. 最终判断

如果现在继续沿着“发现症状就补一刀”的方式开发，RepoRead 短期仍能前进，但每加一个功能点，`generation-pipeline.ts` 和几个 service 文件都会继续变厚，最终进入“功能能做、系统难改”的状态。

所以这件事确实是当前最重要的事。

这轮真正应该优先级最高的任务，不是 P1/P2 功能点，而是：

1. 把运行时从业务流程里剥出来
2. 把 prompt 从 service 文件里剥出来
3. 把 context 和 artifact 这两类状态明确分家

做完这三件事，后续功能开发才是在一个能持续演化的地基上继续长。
