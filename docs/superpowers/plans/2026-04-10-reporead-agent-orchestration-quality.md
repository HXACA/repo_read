# RepoRead：Agent 编排与质量链路完善

> **执行说明：** 推荐使用 superpowers:executing-plans 或 subagent-driven-development 子技能逐项实现本计划。所有步骤使用 `- [ ]` 复选框语法跟踪进度。

**目标：** 弥合「文档化的 agent 架构（`agent-architecture.md`）」与「当前实现」之间的差距，聚焦 **agent 编排** 与 **质量控制** 两条主线。具体包括：把 `fork.worker` 接入页面起草循环、让质量预设真正驱动运行时策略、强制 reviewer 用工具验证引用、保证 research 输出携带 `事实/推断/待确认` 三类标签。

**架构背景：** 当前管线让 `main.author` 直接拿全套检索工具自己跑完所有事，`ForkWorker` 类已经写好却完全闲置；reviewer 虽然有工具但 prompt 没要求它真用；`preset` 字段被解析后只接到三个检索旋钮（max_parallel_reads/line_window/allow_bash），完全没有影响模型策略和重试次数；research 模式没有强制输出结构，也没有持久化。本计划完成后，页面循环将变成 `plan → fork-evidence → draft (基于 ledger) → review (含验证引用) → validate → publish`，预设会驱动一份类型化的 `QualityProfile`，pipeline、reviewer、drafter 三方共享读取，research 输出会被分类标记并持久化。

**技术栈：** Node.js 22、TypeScript strict、Vercel AI SDK (`ai`、`@ai-sdk/anthropic`)、Zod v4、Vitest

**显式不做：** Web UI 改动、CLI 便利性命令（`providers`、`doctor`）、`interrupt/resume`、Web 搜索路由。这些按用户指示推迟，记录在开发 backlog 中。

---

## 范围

本计划覆盖 4 个 phase，对应 PRD §9.4 FR-016、§9.2 FR-009、§11.3 reviewer 严格性要求、§9.5 FR-023 / FR-024。

| Phase | 主题 | 对应 PRD |
| --- | --- | --- |
| 1 | 把 `fork.worker` 接入页面起草循环 | FR-016, agent-arch §4.1 |
| 2 | 质量预设 → 运行时 profile（策略绑定） | FR-009 |
| 3 | reviewer 必须用工具验证引用 | FR-017, agent-arch §11 |
| 4 | research 三标签输出 + 持久化 | FR-023, FR-024 |

**本计划推迟：** interrupt/resume（FR-019）、CLI `providers` 与 `doctor`、Web 搜索页、fork.worker 递归守卫（已由类设计强制）。

---

## 新增依赖

无 —— 所有需要的依赖都已安装。

---

## 文件结构

### 新增文件

```
packages/core/src/
  config/
    quality-profile.ts            # 新增 —— preset → 运行时 QualityProfile 的映射
  generation/
    evidence-planner.ts           # 新增 —— main.author 规划怎么把取证任务拆给 N 个 worker
    evidence-coordinator.ts       # 新增 —— 串联 planner 与并行 worker，汇总到 evidence_ledger
  research/
    research-store.ts             # 新增 —— 把研究笔记持久化到 .reporead/projects/<slug>/research/<id>.json
```

### 修改文件

```
packages/core/src/
  types/
    config.ts                     # ResolvedConfig.qualityProfile（带类型）
    review.ts                     # ReviewConclusion 加 verified_citations
    research.ts                   # ResearchOutput 拆分成 facts/inferences/unconfirmed
  config/
    resolver.ts                   # 从 preset 派生 QualityProfile
  generation/
    generation-pipeline.ts        # 用 evidence coordinator + qualityProfile（不再硬编码重试次数）
    page-drafter.ts               # 接收 evidence_ledger，drafter 角色变成「合成器」而不是「检索者」
    page-drafter-prompt.ts        # prompt 知道有预先收集的证据可用
  review/
    reviewer.ts                   # 消费 qualityProfile.reviewerVerifyMinCitations
    reviewer-prompt.ts            # 强制基于工具的引用验证
  research/
    research-service.ts           # 强制三标签输出，通过 store 持久化
  ask/
    ask-stream.ts                 # 路由判定为 research 时也透传 qualityProfile

packages/core/src/__tests__/
  generation/
    evidence-planner.test.ts      # 新增
    evidence-coordinator.test.ts  # 新增
    generation-pipeline.test.ts   # 更新 mock 适配新流程
  config/
    quality-profile.test.ts       # 新增
  review/
    reviewer.test.ts              # 加 verified_citations 用例
  research/
    research-service.test.ts      # 三标签输出用例
    research-store.test.ts        # 新增
```

---

## Phase 1：把 `fork.worker` 接入页面起草循环

**目标：** 把现在「main.author 自己跑完所有工具」的模式换成「fork.worker 并行预收集证据，main.author 基于干净的 ledger 写作」。这是杠杆最高的改动，因为它同时解锁速度（并行）和质量（main 的 context 更聚焦）。

### 1.1 Evidence planner（main.author 的规划调用）

> **决定**：不使用确定性均分。由 `main.author` 做一次小的 LLM 规划调用，根据页面 plan 和 covered_files 决定如何把工作拆给 N 个 worker。这样每个 worker 拿到的不是"一堆文件"，而是"一个有语义的子任务"（例如"查 API 路由"、"查数据模型"、"查错误处理链路"）。

- [ ] 新建 `packages/core/src/generation/evidence-planner.ts`
- [ ] 定义类型：
  ```ts
  type EvidenceTask = {
    id: string;              // 短 id，如 "t1"
    directive: string;       // 自然语言指令，说明该 worker 要找什么
    targetFiles: string[];   // 建议读取的文件子集（允许与其他 task 轻微重叠）
    rationale: string;       // 为什么选这些文件
  };
  type EvidencePlan = { tasks: EvidenceTask[] };
  type EvidencePlanInput = {
    pageTitle: string;
    pageRationale: string;
    coveredFiles: string[];
    pageOrder: number;
    publishedSummaries: Array<{ slug: string; title: string; summary: string }>;
    taskCount: number;
    language: string;        // 来自 config，控制 directive/rationale 的语言
  };
  ```
- [ ] 实现 `class EvidencePlanner { constructor(options: { model: LanguageModel }); async plan(input: EvidencePlanInput): Promise<EvidencePlan> }`
- [ ] Prompt 要求 LLM 输出严格 JSON：
  ```json
  {
    "tasks": [
      {
        "id": "t1",
        "directive": "查找所有 FastAPI 路由定义，记录路径、方法、handler 函数",
        "targetFiles": ["api/api.py"],
        "rationale": "这是主路由文件，承担 HTTP 入口职责"
      }
    ]
  }
  ```
- [ ] 约束：
  - 任务数量严格等于 `taskCount`（若 `coveredFiles.length < taskCount`，降级到 `min(taskCount, coveredFiles.length)`）
  - 每个 task 至少包含一个 targetFile
  - 所有 coveredFiles 必须被至少一个 task 覆盖
  - `directive` 与 `rationale` 必须使用 `input.language`（中文项目输出中文）
- [ ] 服务端解析后做完整校验，不满足约束就 fallback 到确定性均分（保底）
- [ ] 规划调用本身不允许调工具（纯 JSON 输出），用 `stopWhen: stepCountIs(1)` + 无 `tools` 参数；模型来自 `main.author` 角色
- [ ] 记录规划调用的 tokens 与耗时，方便后续评估成本

### 1.2 Evidence coordinator 骨架

- [ ] 新建 `packages/core/src/generation/evidence-coordinator.ts`
- [ ] 定义 `EvidenceCoordinatorOptions { plannerModel: LanguageModel; workerModel: LanguageModel; repoRoot: string; concurrency: number }`
- [ ] 定义 `EvidenceLedgerEntry`（复用 `MainAuthorContext.evidence_ledger[number]`）
- [ ] 定义 `EvidenceCollectionResult { ledger: EvidenceLedgerEntry[]; findings: string[]; openQuestions: string[]; plan: EvidencePlan; failedTaskIds: string[] }`
- [ ] 实现 `class EvidenceCoordinator { async collect(input: CollectInput): Promise<EvidenceCollectionResult> }`
  - **Step 1 — 规划**：调 `EvidencePlanner.plan(...)` 得到 `EvidencePlan`
    - 规划失败时降级到确定性均分：把 `coveredFiles` 按顺序均匀切成 `taskCount` 份，每个 task 的 directive 统一为"收集这些文件中与 `{pageTitle}` 相关的关键结构、函数、类型和引用"
  - **Step 2 — 并行执行**：对每个 task 调 `ForkWorker.execute(input)`，用 `Promise.all` 配合 `concurrency` 上限
    - **单 worker 失败处理**：某个 worker 抛异常或返回 `success: false` 时，coordinator **再重试一次**；两次都失败则把该 taskId 加入 `failedTaskIds`，跳过它继续用剩下的结果（保底降级，不阻塞整页）
    - 每个 worker 独立计时（用于事件日志）
  - **Step 3 — 汇总**：
    - 把所有成功 worker 的 `citations` 合并去重成 `evidence_ledger`（去重 key = `kind:target:locator`）
    - 扁平化合并所有 `findings`
    - 扁平化合并所有 `open_questions`
  - 返回 `EvidenceCollectionResult`

### 1.3 Page drafter 消费预收集证据

- [ ] 修改 `packages/core/src/generation/page-drafter-prompt.ts`
  - 当 `context.evidence_ledger.length > 0` 时，在 `buildPageDraftUserPrompt` 中追加 "Pre-collected Evidence (from fork.workers)" 段落
  - 包含 findings、citations、open questions
  - 修改 `Instructions`：「优先使用上述证据；只在需要二次核实或填补 open questions 时才调用检索工具。」
- [ ] 更新 `PageDrafter.draft()` —— 签名不变（依然接收 `MainAuthorContext`），区别只是 `evidence_ledger` 现在非空

### 1.4 Pipeline 集成

- [ ] 修改 `generation-pipeline.ts`
  - 在每页的循环里，`drafter.draft(...)` 之前实例化 `EvidenceCoordinator`，使用 `qualityProfile.forkWorkers` 个 worker
  - 调 `coordinator.collect({ page, taskCount: qualityProfile.forkWorkers, ... })` 拿到 `EvidenceCollectionResult`
  - 把 `result.ledger` 灌入 `MainAuthorContext.evidence_ledger`
  - 发出新事件 `page.evidence_planned`（任务数 + 规划 token）
  - 发出新事件 `page.evidence_collected`（含 citation 数、worker 数、失败 task 数）
  - 重试时：只有当上一次 reviewer 在 `missing_evidence` 里追加了新条目时，才重新跑 coordinator（否则复用已收集的 ledger，避免重复 token 成本）
- [ ] `plannerModel` 从 `createModelForRole(resolvedConfig, "main.author", { apiKeys })` 拿
- [ ] `workerModel` 从 `createModelForRole(resolvedConfig, "fork.worker", { apiKeys })` 拿
- [ ] 更新 `JobEventEmitter`，新增：
  - `pageEvidencePlanned(slug, taskCount)`
  - `pageEvidenceCollected(slug, citationCount, workerCount, failedCount)`

### 1.5 Phase 1 测试

- [ ] `evidence-planner.test.ts`
  - 正常情况：返回的 `tasks` 数等于 `taskCount`，所有 `coveredFiles` 都被覆盖
  - `coveredFiles.length < taskCount`：降级到 `coveredFiles.length` 个 task
  - LLM 输出非法 JSON 时，caller 能捕获错误以便 fallback
  - LLM 输出少 task / 漏文件 / 空 targetFiles 时，校验函数返回 false
- [ ] `evidence-coordinator.test.ts`
  - 正常路径：planner + 并行 worker + 汇总 ledger
  - Planner 失败时降级到均分策略（mock planner 抛异常）
  - 单 worker 首次失败、第二次成功 → 结果包含该 worker 的 citations
  - 单 worker 两次都失败 → `failedTaskIds` 含该 id，其他 worker 结果正常
  - 跨 worker 的重复 citation 被合并去重（mock `ForkWorker.execute`）
  - 并发上限受控（mock 检测同时在飞的 `execute()` 调用不超过 `concurrency`）
- [ ] 更新 `generation-pipeline.test.ts`
  - 同时 mock `EvidencePlanner`、`ForkWorker`、`PageDrafter`
  - 断言每页首次尝试时 planner 与 ForkWorker 被调用
  - 断言 `pageDrafter.draft` 被调用时 `evidence_ledger` 非空
  - 断言事件序列为 `page.drafting → page.evidence_planned → page.evidence_collected → page.drafted`

### 1.6 Phase 1 验收

- [ ] 所有 Phase 1 测试通过
- [ ] `pnpm --filter @reporead/core run build` 通过
- [ ] 跑一个单页生成 fixture，确认草稿至少引用一条来自 worker 的证据（即不是 drafter 自己工具调用产生的）

---

## Phase 2：质量预设 → 运行时 Profile

**目标：** 让 `preset` 真正成为有效的拉杆。今天它只影响检索；本 phase 完成后它会控制 fork 数、重试预算、reviewer 严格度、drafter 步数预算、reviewer 验证下限。

### 2.1 定义 QualityProfile 类型

- [ ] 新建 `packages/core/src/config/quality-profile.ts`
- [ ] 定义 `QualityProfile`：

```ts
type QualityProfile = {
  forkWorkers: number;                  // 0 表示禁用 coordinator
  forkWorkerConcurrency: number;
  maxRevisionAttempts: number;
  drafterMaxSteps: number;
  reviewerMaxSteps: number;
  reviewerVerifyMinCitations: number;   // 0 表示禁用强制验证
  reviewerStrictness: "lenient" | "normal" | "strict";
};
```

- [ ] 定义 `QUALITY_PROFILES: Record<Preset, QualityProfile>`

| 字段 | quality | balanced | budget | local-only |
| --- | --- | --- | --- | --- |
| forkWorkers | 3 | 2 | 1 | 1 |
| forkWorkerConcurrency | 3 | 2 | 1 | 1 |
| maxRevisionAttempts | 3 | 2 | 1 | 1 |
| drafterMaxSteps | 30 | 20 | 12 | 12 |
| reviewerMaxSteps | 15 | 10 | 6 | 6 |
| reviewerVerifyMinCitations | 3 | 2 | 0 | 0 |
| reviewerStrictness | strict | normal | lenient | normal |

- [ ] 导出 helper `getQualityProfile(preset: Preset): QualityProfile`

### 2.2 接入 ResolvedConfig

- [ ] 修改 `packages/core/src/types/config.ts`
  - 在 `ResolvedConfig` 加 `qualityProfile: QualityProfile`
- [ ] 修改 `packages/core/src/config/resolver.ts`
  - 设置 `qualityProfile: getQualityProfile(config.preset)`
- [ ] 更新构造 `ResolvedConfig` mock 的现有测试（`generation-pipeline.test.ts`、`model-factory.test.ts`、`e2e-pipeline.test.ts`），加入 `qualityProfile` 字段

### 2.3 替换硬编码常量

- [ ] `generation-pipeline.ts`：把 `MAX_REVISION_ATTEMPTS = 2` 替换成 `this.config.qualityProfile.maxRevisionAttempts`
- [ ] `page-drafter.ts`：用 `qualityProfile.drafterMaxSteps` 作为 `stopWhen: stepCountIs(...)`
  - Drafter 构造函数需要接收 `maxSteps` 选项
- [ ] `reviewer.ts`：用 `qualityProfile.reviewerMaxSteps`
- [ ] `evidence-coordinator.ts`：用 `qualityProfile.forkWorkers` 与 `forkWorkerConcurrency`

### 2.4 Phase 2 测试

- [ ] `quality-profile.test.ts`
  - 每个 preset 返回文档化的具体值
  - profile 值不可变（深度冻结），getter 多次调用返回同一引用
- [ ] Resolver 测试：`quality` preset 配置产生 `ResolvedConfig.qualityProfile.forkWorkers === 3`
- [ ] Pipeline 测试：传入 `budget` preset 时，重试循环最多在初稿之外再跑 1 次

### 2.5 Phase 2 验收

- [ ] 所有 Phase 1 测试在加了 profile 之后依然通过
- [ ] 所有 Phase 2 新增测试通过
- [ ] Build 通过
- [ ] 抽查生成的页面 meta 验证 `revisionAttempts <= profile.maxRevisionAttempts`

---

## Phase 3：Reviewer 工具验证

**目标：** 强制 reviewer 真正调用工具验证 N 条关键引用，而不是「想用就用」。Reviewer 变成一个真正的事实核查环节，而不是「靠感觉」过稿。

### 3.1 扩展 ReviewConclusion 类型

- [ ] 修改 `packages/core/src/types/review.ts`

```ts
type VerifiedCitation = {
  citation: { kind: "file" | "page" | "commit"; target: string; locator?: string };
  status: "match" | "mismatch" | "not_found";
  note?: string;
};

type ReviewConclusion = {
  verdict: "pass" | "revise";
  blockers: string[];
  factual_risks: string[];
  missing_evidence: string[];
  scope_violations: string[];
  suggested_revisions: string[];
  verified_citations?: VerifiedCitation[];   // 新增
};
```

- [ ] 向后兼容：`verified_citations` 是可选字段，旧 review.json 文件依然可解析

### 3.2 Reviewer prompt 强制验证

- [ ] 修改 `reviewer-prompt.ts`
  - 加入「Verification Requirement」段落：
    - 「你必须调用 `read` 工具验证至少 N 条草稿中的关键引用，N = {minCitations}。」
    - 「为每条验证过的引用，在 `verified_citations` 中记录一项，`status` 取 `match | mismatch | not_found`。」
    - 「任何 `mismatch` 或 `not_found` 必须同时加入 `blockers`。」
    - 「行号差 ±5 行内但符号名一致，视为 `match`。」
  - `buildReviewerSystemPrompt` 接收 `minCitations: number` 参数
- [ ] 修改 `reviewer.ts`：
  - 通过构造函数或方法参数接收 `qualityProfile.reviewerVerifyMinCitations`
  - 传给 `buildReviewerSystemPrompt`
  - 在 `parseOutput` 中：如果 `verified_citations` 含有任何非 `match` 状态但未在 `blockers` 中，防御性地补到 `blockers`
- [ ] `minCitations === 0` 时跳过整个验证段落（budget 模式）

### 3.3 Pipeline 把 profile 传给 reviewer

- [ ] `generation-pipeline.ts`：构造 `FreshReviewer` 时传入 `verifyMinCitations: this.config.qualityProfile.reviewerVerifyMinCitations`

### 3.4 Phase 3 测试

- [ ] `reviewer.test.ts`
  - mock `generateText` 返回带 `verified_citations: [{ status: 'mismatch' }]` 的结论
  - 断言 pipeline 在重试用尽后把页面标为 `accepted_with_notes`
  - 断言 `minCitations: 0` 时 reviewer prompt 不包含验证段落
  - 断言 `mismatch` 引用被自动升级为 `blockers`

### 3.5 Phase 3 验收

- [ ] 所有测试通过
- [ ] Build 通过
- [ ] 抽查 `quality` preset 一次跑后，至少一页的 `review.json` 含有至少 3 条 `verified_citations`

---

## Phase 4：Research 三标签输出 + 持久化

**目标：** Research 输出必须把每条结论标记成 事实 / 推断 / 待确认（PRD FR-023），并必须以研究笔记的形式持久化（FR-024），让用户可以回头查看。

### 4.1 调研当前 research 模块

- [ ] 阅读 `packages/core/src/research/research-service.ts`、`research-planner.ts`、`research-executor.ts`
- [ ] 找到产生最终回答的 synthesis 步骤
- [ ] 记录当前输出类型，以及它（是否）被持久化

### 4.2 定义带标签的 research 输出类型

- [ ] 修改或新建 `packages/core/src/types/research.ts`

```ts
type LabeledFinding = {
  statement: string;
  citations: Array<{ kind: "file" | "page" | "commit"; target: string; locator?: string }>;
};

type ResearchNote = {
  id: string;
  projectSlug: string;
  versionId: string;
  topic: string;
  createdAt: string;
  facts: LabeledFinding[];        // 事实
  inferences: LabeledFinding[];   // 推断
  unconfirmed: LabeledFinding[];  // 待确认
  summary: string;                // 总体合成
};
```

### 4.3 Synthesizer prompt 强制三标签

- [ ] 修改 research synthesis prompt，明确要求三个分类段落
- [ ] 提供期望的 JSON shape（对应 `ResearchNote` 去掉元信息）
- [ ] 服务端解析器校验每条结论恰好落在三类之一

### 4.4 Research store

- [ ] 新建 `packages/core/src/research/research-store.ts`
- [ ] `class ResearchStore { constructor(storage: StorageAdapter); async save(note: ResearchNote): Promise<void>; async list(slug: string, versionId: string): Promise<ResearchNote[]>; async get(slug: string, versionId: string, id: string): Promise<ResearchNote | null> }`
- [ ] 路径方案：
  - `.reporead/projects/<slug>/research/<versionId>/<id>.json`
- [ ] 在 `StoragePaths` 加 helper 指向 research 目录

### 4.5 Pipeline / service 接线

- [ ] `ResearchService.run(...)` 产出 `ResearchNote` 并调 `store.save(note)`
- [ ] 服务返回 note id，方便 caller（CLI / web ask 路由）链接到笔记
- [ ] 当 `ask-stream` 把路由判定为 `research` 时，跑 research 路径，并最终 yield 一个 `research_note_saved` 事件携带 note id

### 4.6 Phase 4 测试

- [ ] 更新 `research-service.test.ts`
  - mock 一个合法的三标签 JSON synthesis 结果，断言被正确解析
  - mock 一个缺失 `unconfirmed` 的结果，断言解析报错（或有合理默认值）
  - mock store，断言 `save` 被调用且 `note.id` 非空
- [ ] 新增 `research-store.test.ts`
  - save 后 list 能返回该笔记
  - save 后 get(id) 能返回该笔记
  - 目录方案符合路径规约

### 4.7 Phase 4 验收

- [ ] 所有测试通过
- [ ] Build 通过
- [ ] 手动跑一次 research 查询，确认 `.json` 落盘到 `.reporead/projects/.../research/<versionId>/`
- [ ] 落盘的笔记三类数组都存在（即使有的为空）

---

## 横切事项

### 类型/测试 fixture 更新

- [ ] 所有现有构造 `ResolvedConfig` mock 的测试都要加 `qualityProfile: getQualityProfile("quality")`（或选定的 preset）
- [ ] `e2e-pipeline.test.ts` 烟雾测试除了加 fixture 字段外应该不需要其他改动

### 文档

- [ ] 更新 `docs/agent-architecture.md` §4，注明实现现在通过 `EvidenceCoordinator` 接入 `fork.worker`
- [ ] 如果 `docs/design.md` 包含页面循环图，同步更新
- [ ] 在 `README.md` 加一段简要说明 preset → quality profile 的映射表

### 向后兼容

- 所有现有 `config.json` 文件依然可解析（schema 没变；`qualityProfile` 在 resolve 时从 `preset` 派生）
- 现有 `review.json` 文件依然可加载（`verified_citations` 可选）
- 现有 `version.json` 与页面 meta 文件不受影响
- 旧 research 输出（目前没有持久化）不受影响

---

## 验收与签收

- [ ] `pnpm --filter @reporead/core run build` 通过
- [ ] `pnpm --filter @reporead/core run test` 全绿（210+ 现有测试 + 新增测试）
- [ ] `pnpm --filter @reporead/cli run build` 通过
- [ ] `pnpm --filter @reporead/web run build` 通过（API 表面没变；web 应正常构建）
- [ ] 在 `deepwiki-open` 仓库用 `quality` preset 做手动烟雾测试：
  - Pipeline 发出 `page.evidence_collected` 事件
  - 每个完成页面的 `revisionAttempts <= 3`
  - 至少 50% 页面达到 `verdict: pass`（vs 当前 ~30%）
  - 至少一页的 review.json 含有非空 `verified_citations`
- [ ] 同一仓库用 `budget` preset 做对比烟雾测试：
  - 没有 forkWorker 步骤（或只有 1 个 worker）
  - `revisionAttempts <= 1`
  - 总耗时显著比 `quality` 跑要短

---

## 风险与开放问题

### 风险

1. **fork.worker 的 token 成本**：把证据拆成 3 路并行调用相比单次 drafter 调用会增加 token 总量。缓解：每个 worker 只看自己的文件批次，不需要看全仓库；main.author 不再需要在 context 里持有原始工具调用结果。
2. **Reviewer 过于严格**：强制工具验证可能会让一些行号略有偏移的引用被标为 `mismatch`。缓解：prompt 告诉 reviewer 行号 ±5 行漂移、符号名一致即视为 `match`。
3. **现有测试 fixture churn**：很多测试构造 `ResolvedConfig` 都需要加新字段，可能引发级联失败。缓解：新增测试 helper `makeTestResolvedConfig({ preset: "quality" })`，把 fixture 迁移过去。
4. **Research 路径改动会影响 ask-stream**：需要确认 ask-stream 中的 research 模式仍能正确把事件流给前端 chat dock，不破坏 SSE 协议。

### 已决策事项

1. **Phase 1 的文件分批策略**：由 `main.author` 做一次小的 LLM 规划调用来决定怎么拆分任务给 worker。每个 worker 拿到的是"有语义的子任务"（含 directive + targetFiles + rationale），而不是一堆文件。规划失败时降级到确定性均分。
2. **Coordinator 的 worker 失败处理**：单个 worker 失败时重试一次；两次都失败则把该 taskId 加入 `failedTaskIds`，跳过该 task 继续用其他 worker 的结果（不阻塞整页）。
3. **重试时 reviewer 是否重新验证引用**：重新验证。`fresh.reviewer` 的独立性是核心，每次审稿都是全新会话、全新验证。
4. **Research 笔记 id 方案**：UUID（与现有 job/session id 保持一致）。

---

## 执行顺序

硬依赖：Phase 1 必须在 Phase 2 之前（因为 Phase 2 只有当 `forkWorkers` 真正驱动行为时才有意义）。Phase 3 可以在 Phase 2 之后。Phase 4 独立，任何时候都可以做。

单次执行会话推荐顺序：

1. Phase 2.1（先定义 `QualityProfile` 类型）—— 改动小，能解锁后续
2. Phase 1（evidence coordinator + drafter 集成）
3. Phase 2.2-2.5（替换硬编码常量、把 profile 接入 pipeline）
4. Phase 3（reviewer 验证）
5. Phase 4（research）—— 如果时间紧可以拆到下一个会话
6. 横切的 fixture/文档更新

每完成一个 phase 都跑一次测试套件。Phase 1+2+3 完成后，在 `deepwiki-open` 上跑一次 `quality` preset 的手动烟雾测试，把指标写进验收章节。
