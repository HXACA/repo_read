# Throughput 50%+ Reduction 设计文档

> 时间：2026-04-17
> 状态：已审核，待实施
> 前提：P6b page overlap 已上线，quality profile 和 escalation policy 已生效

---

## 0. 这份文档解决什么问题

三个真实项目的吞吐基线跑出来后（见 `docs/superpowers/plans/2026-04-14-throughput-benchmark-notes.md`），单页平均 28-35 min、全项目 7-17h 的时长让增量迭代和批量重跑都非常痛苦。

目标：**wall time 减少 60%+**。

不靠单点调优，而是三件事叠加：
1. 切断无效的 evidence re-run 循环（纯工程，零质量损失）
2. 去掉 deep lane 的 max revisions +1 bonus（质量参数，每项目 ≤1 页 L2→L1）
3. 引入 N-way page parallel scheduler（架构改造，默认 N=3）

不做：
- 完整的 execution graph / DAG 调度
- provider 级别的 rate limiter（复用现有 `forkWorkerConcurrency` × `pageConcurrency` 自然约束）
- Evidence Fabric 正式版（仅 Phase 3 可选骨架，不在本文档范围）

---

## 1. 根本原因分析

### 1.1 Evidence re-run 循环无效消耗

`generation-pipeline.ts:597-603`:

```typescript
const shouldCollectEvidence =
  coordinator !== null &&
  ((attempt === 0 && !evidenceResult) ||
    (attempt > 0 &&
      ((reviewResult?.conclusion?.missing_evidence?.length ?? 0) > 0 ||
        (reviewResult?.conclusion?.factual_risks?.length ?? 0) > 0 ||
        (reviewResult?.conclusion?.scope_violations?.length ?? 0) > 0)));
```

只要 reviewer 标记 `missing_evidence` / `factual_risks` / `scope_violations`，每次 revision 都会触发一次 incremental evidence collection（~5-7 min）。

基线数据显示：

| 项目 | 命中 max revisions 的页 | 其中最终 L1 的页 |
|------|------------------------|-----------------|
| repo-read | 10/19 (53%) | **9/10** |
| hermes-agent | ~12/32 (38%) | **~10/12** |
| trpc-go | ~6/19 (32%) | **~5/6** |

结论：**绝大多数命中 max revisions 的页面最终仍停在 L1**，审查器反复标记同类问题，evidence 补充无法根本改善。这部分 re-run 是纯粹的浪费。

repo-read `repository-model` 实测：4 次 evidence re-run × ~6.8 min = 27 min 浪费在一页上。

### 1.2 Deep lane 的 +1 revision bonus 回报率低

`escalation-policy.ts:35` 给 deep lane 加 +1 revision（quality preset base=3 → deep=4）。

实测：第 4 次 revision 帮助 1/10 的 deep 页面从 L1 升到 L2（repo-read 的 `runtime-tooling`）。即 90% 的 deep 页面不需要第 4 次 revision。

### 1.3 页面串行

`generation-pipeline.ts:249-294` 是严格的 `for` 循环，page[i+1] 必须等 page[i] 完全 validate 后才能启动。P6b prefetch 只重叠了 evidence+outline 阶段（占总时长 30%），revision loop 阶段（占 50%+）没有任何并行。

---

## 2. 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Evidence 调用次数上限 | 总共 2 次（1 initial + 1 incremental） | 基线数据显示第 2 次 re-run 之后收益极低 |
| max_revisions 调整 | 去掉 deep lane 的 +1 bonus | 90% 的 deep 页面用不到第 4 次 revision |
| 页面并发策略 | sliding window semaphore | 简单、可预测、和现有 forkWorkerConcurrency 天然叠加 |
| 默认并发数 | 3 | 基于 LLM provider 典型限额测算，可用 CLI flag 覆盖 |
| publishedSummaries 同步点 | review 开始前必须 await 前页 validate | 保证 reviewer 看到最新去重上下文，draft 容忍 stale |
| Provider rate limit | 不新增限流器 | 复用 forkWorkerConcurrency × pageConcurrency + AI SDK 自带 retry |
| 回退机制 | pageConcurrency=1 完全等价于串行 | 让现有行为成为默认 opt-out 路径 |

---

## 3. 组件 1：Evidence Re-run Cap（Phase 1）

### 3.1 QualityProfile 新字段

`packages/core/src/config/quality-profile.ts`：

```typescript
export type QualityProfile = {
  // ...existing fields...
  maxEvidenceAttempts: number;  // 新增
};

const QUALITY_PROFILES: Record<QualityPreset, QualityProfile> = {
  quality:    { ...existing, maxEvidenceAttempts: 2 },
  balanced:   { ...existing, maxEvidenceAttempts: 2 },
  budget:     { ...existing, maxEvidenceAttempts: 1 },
  "local-only": { ...existing, maxEvidenceAttempts: 1 },
};
```

`LaneExecutionPolicy` 复用该字段（不走 lane 调整）。

### 3.2 Pipeline 改造

`packages/core/src/generation/generation-pipeline.ts:597-603`：

```typescript
// 在 runPageWorkflow 顶部初始化
let evidenceCollectionCount = 0;

// 如果 prefetch 已经加载了 evidence（attempt=0 && artifactsReady.evidence），也计入一次
if (prefetchSlot?.artifactsReady.evidence) {
  evidenceCollectionCount = 1;
}

// 修改 shouldCollectEvidence 条件
const shouldCollectEvidence =
  coordinator !== null &&
  evidenceCollectionCount < qp.maxEvidenceAttempts &&  // 新增上限
  ((attempt === 0 && !evidenceResult) ||
    (attempt > 0 && /* ...existing trigger conditions... */));

if (shouldCollectEvidence) {
  evidenceCollectionCount++;
  // ...existing collect logic...
}
```

### 3.3 行为契约

- `maxEvidenceAttempts=2` (quality preset)：1 次 initial（通常来自 prefetch）+ 最多 1 次 incremental re-run。之后 reviewer 即使标记 `missing_evidence` 也不再触发重跑，drafter 直接基于现有 ledger 改写。
- `maxEvidenceAttempts=1` (budget preset)：仅 initial，永远不 re-run。
- 如果初始 evidence 就失败（prefetch miss + inline collect fail），不计入 count，保证首次必有 evidence。

### 3.4 预期影响

- 9-10 个 L1 页/项目：每页节省 2-3 次 evidence re-run × ~6 min = 12-18 min
- 无 L2 页面质量下降（L2 页面通常 ≤1 次 re-run 就通过）
- repo-read: 9.1h → ~7.2h（−21%）
- hermes-agent: 17.3h → ~13.3h（−23%）

---

## 4. 组件 2：Max Revisions Deep Lane +1 移除（Phase 1）

### 4.1 LaneExecutionPolicy 改造

`packages/core/src/generation/escalation-policy.ts:35`：

```typescript
// 原
maxRevisionAttempts: lane === "deep"
  ? params.maxRevisionAttempts + 1
  : params.maxRevisionAttempts,

// 改
maxRevisionAttempts: lane === "deep"
  ? params.maxRevisionAttempts + qp.deepLaneRevisionBonus
  : params.maxRevisionAttempts,
```

### 4.2 QualityProfile 新字段

```typescript
export type QualityProfile = {
  // ...existing + maxEvidenceAttempts...
  deepLaneRevisionBonus: number;  // 新增
};

const QUALITY_PROFILES = {
  quality:    { maxRevisionAttempts: 3, deepLaneRevisionBonus: 0 },  // deep=3（原 4）
  balanced:   { maxRevisionAttempts: 2, deepLaneRevisionBonus: 0 },  // deep=2（原 3）
  budget:     { maxRevisionAttempts: 1, deepLaneRevisionBonus: 0 },  // deep=1（原 2）
  "local-only": { maxRevisionAttempts: 1, deepLaneRevisionBonus: 0 },
};
```

默认值 0 代表本次更改。如果后续发现某个项目质量下降太多，可以把 quality preset 的 `deepLaneRevisionBonus` 调回 1 作为 escape hatch。

### 4.3 预期影响

- 每项目 ~1 页 L2→L1（那些刚好需要第 4 次 revision 才收敛的页面）
- 10 个命中 max 的 L1 页/项目：每页节省 1 次 revision（draft+review ≈ 4 min）
- 叠加组件 1 后：repo-read 额外 −5%（7.2h → 6.5h）

---

## 5. 组件 3：N-way Page Parallel Scheduler（Phase 2）

### 5.1 QualityProfile 新字段

```typescript
export type QualityProfile = {
  // ...existing + maxEvidenceAttempts + deepLaneRevisionBonus...
  pageConcurrency: number;  // 新增
};

const QUALITY_PROFILES = {
  quality:    { pageConcurrency: 3 },
  balanced:   { pageConcurrency: 2 },
  budget:     { pageConcurrency: 1 },
  "local-only": { pageConcurrency: 1 },
};
```

CLI 覆盖（`packages/cli/src/commands/generate.tsx`）：

```
--page-concurrency <n>   覆盖 qp.pageConcurrency（1 <= n <= 5）
```

`pageConcurrency=1` 的代码路径必须完全等价于现有串行行为（回退安全网）。

### 5.2 新文件：ParallelPageScheduler

`packages/core/src/generation/parallel-scheduler.ts`:

```typescript
import { Semaphore } from "./semaphore.js";  // 新增，简单的 counting semaphore

export type PageGate = {
  promise: Promise<void>;
  resolve: () => void;
};

export function createGate(): PageGate {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

export type ParallelSchedulerOptions = {
  concurrency: number;
  runPage: (ctx: PageRunContext) => Promise<PageRunResult>;
};

export type PageRunContext = {
  page: WikiJson["reading_order"][number];
  pageIndex: number;
  reviewGate: Promise<void>;   // 传入 runPageWorkflow
  onFirstReviewStart?: () => void;
};

export type PublishedSummary = { slug: string; title: string; summary: string };

export type PageRunResult = {
  success: boolean;
  summary?: PublishedSummary;
  error?: string;
  pageMetrics?: PageThroughputRecord;
};

export class ParallelPageScheduler {
  constructor(private readonly opts: ParallelSchedulerOptions) {}

  async runAll(
    pages: WikiJson["reading_order"],
    publishedSummaries: PublishedSummary[],  // shared mutable
  ): Promise<PageRunResult[]> {
    const { concurrency, runPage } = this.opts;
    const gates = pages.map(() => createGate());
    const semaphore = new Semaphore(concurrency);
    const results = new Array<PageRunResult>(pages.length);

    await Promise.all(pages.map(async (page, i) => {
      await semaphore.acquire();
      try {
        const reviewGate = i > 0 ? gates[i - 1].promise : Promise.resolve();
        const result = await runPage({
          page,
          pageIndex: i,
          reviewGate,
        });
        if (result.success && result.summary) {
          publishedSummaries.push(result.summary);
        }
        results[i] = result;
      } finally {
        gates[i].resolve();  // 即使失败也要 resolve，避免后续页永久阻塞
        semaphore.release();
      }
    }));

    return results;
  }
}
```

### 5.3 Semaphore 实现

`packages/core/src/generation/semaphore.ts`（新文件，内部工具）:

```typescript
export class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(count: number) {
    if (count < 1) throw new Error(`Semaphore count must be >= 1, got ${count}`);
    this.permits = count;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.permits++;
  }
}
```

### 5.4 runPageWorkflow 改造

`packages/core/src/generation/generation-pipeline.ts`:

```typescript
async runPageWorkflow(ctx: {
  // ...existing...
  reviewGate: Promise<void>;           // 新增
  onFirstReviewStart?: () => void;     // 新增
}): Promise<PageRunResult> {
  // ...existing evidence/outline/draft loop...
  
  // 在第一次 review 前等待前页 summary 就绪
  if (attempt === 0) {
    const gateStart = Date.now();
    await ctx.reviewGate;
    // 可选：记录到 throughput metrics
    ctx.onFirstReviewStart?.();
  }
  
  // ...existing review/revision loop...
}
```

`publishedSummaries` 从 ctx 字段改为 scheduler 管理的 shared reference。读取点（drafter 构造 context）直接 snapshot 当前数组；写入点（validate 完成后）改为 scheduler 的 `results[i].summary` 再统一 push。

### 5.5 Pipeline 主循环替换

`packages/core/src/generation/generation-pipeline.ts:249-294`:

```typescript
// 原：for loop
// 改：
const scheduler = new ParallelPageScheduler({
  concurrency: qp.pageConcurrency,
  runPage: (pageCtx) => this.runPageWorkflow({
    ...pageCtx,
    /* 其他参数从外层闭包传入 */
  }),
});
const results = await scheduler.runAll(wiki.reading_order, publishedSummaries);
```

prefetch 逻辑继续有效——它在 runPageWorkflow 内部启动的，scheduler 层不需要关心。

### 5.6 publishedSummaries 语义

关键契约：

| 读取点 | 看到的 summaries |
|--------|-----------------|
| page[i] 的 evidence collection | 含 page[0..i-N] 的 summary（N = pageConcurrency）|
| page[i] 的 first draft | 含 page[0..i-N] 的 summary（与 evidence 同时 snapshot）|
| page[i] 的 first review | 含 page[0..i-1] 的 summary（reviewGate 保证）|
| page[i] 的 revision loop | 含 page[0..i-1] 的 summary（已过 gate）|

draft 阶段的 stale summaries 是设计决策——允许前期轻微重复，由 review 阶段发现并修订。

### 5.7 错误传播

- 单页 `runPageWorkflow` 失败（throw）：scheduler 捕获，记录为 `results[i].success=false`，**仍然 resolve 自己的 gate**（否则后续页永久阻塞）
- 多页并发失败：所有页跑完后，pipeline 汇总错误，决定整个 job 状态
- 保留现有的 resume 逻辑：下次启动时 skipSlugs 跳过已 validate 页面

### 5.8 预期影响

- 基于组件 1+2 后的 6.5h baseline
- 理论加速上限：6.5h / 3 = 2.2h
- 实际（考虑 gate 等待、尾页串行、forkWorker 竞争）：~3.2h
- 相对原始 9.1h baseline：**−65%**

hermes-agent 类似比例：17.3h → ~6.0h（−65%）

---

## 6. 测试策略

### 6.1 单元测试

- `parallel-scheduler.test.ts`
  - 空页数组
  - 单页（concurrency=1）
  - 10 页 concurrency=3，验证 gate 顺序（通过 mock runPage 的执行顺序断言）
  - 中间某页失败，后续页仍能继续
  - concurrency > pages 数量
  - concurrency=1 完全等价于串行（与现有 pipeline 跑同一组 mock 对比）
- `semaphore.test.ts`
  - 并发获取超出 permits
  - release 后队列中的 acquire 立即 resolve
  - invalid count（<1）抛错
- `quality-profile.test.ts`
  - 新字段默认值
  - preset 覆盖关系

### 6.2 集成测试

- `generation-pipeline-parallel.test.ts`（新）
  - mock LLM + mock artifact store，跑 5 页 concurrency=3
  - 验证 publishedSummaries 最终顺序正确
  - 验证 reviewGate 确实阻塞 review（中间页的 review 必须在前页 validate 之后）
  - 验证 evidence count 上限生效
  - 验证 deep lane max revisions = 3

### 6.3 E2E 回归

- 在 repo-read 自身上跑 `--page-concurrency 1` vs `--page-concurrency 3`
- 对比产物 diff：允许的差异仅限 metadata 顺序、time stamps；核心内容应该一致（允许 review 触发的轻微修订差异）

### 6.4 压测

- hermes-agent 跑 concurrency=3 和 concurrency=5
- 监测：
  - 总 wall time
  - provider 限流次数（AI SDK retry 计数）
  - 内存峰值
  - CPU 占用
- 如果 concurrency=5 出现明显 provider 限流，默认值维持在 3

---

## 7. 分阶段交付

### Phase 1（W1）：组件 1+2

- `maxEvidenceAttempts` 字段 + pipeline 条件
- `deepLaneRevisionBonus` 字段 + escalation policy
- 单元测试
- 在 repo-read 自身跑一次验证（预期 −25% 到 −30%）
- 提交 PR，合并前 review

### Phase 2（W2-3）：组件 3

- `Semaphore` 工具类
- `ParallelPageScheduler`
- `runPageWorkflow` 改 reviewGate 参数
- `publishedSummaries` 改 shared reference
- Pipeline 主循环切换到 scheduler
- 单元 + 集成测试
- E2E 回归（repo-read、hermes-agent、trpc-go 三项目）
- 压测 + 文档更新

### Phase 3（可选，W4+）

如果 Phase 2 已达 60%+ 目标，Phase 3 暂时不做。否则按照 `docs/superpowers/plans/2026-04-14-throughput-secondary-line.md` 的 Evidence Fabric 骨架继续推进。

---

## 8. 回退策略

| 回退层级 | 操作 | 影响 |
|---------|------|------|
| 组件 3 | `--page-concurrency 1` | 完全等价于串行，其他优化保留 |
| 组件 2 | quality preset 的 `deepLaneRevisionBonus=1` | deep lane 恢复 max=4 |
| 组件 1 | quality preset 的 `maxEvidenceAttempts=99` | 恢复原行为（无上限）|
| 全部回退 | git revert 对应 commit | — |

三层独立，单点回退不影响其他组件。

---

## 9. 风险清单

| 风险 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| Gate 泄漏（页失败没 resolve） | 中 | 死锁 | `try-finally` 确保 resolve；scheduler 整体 timeout 兜底 |
| publishedSummaries race condition | 低 | 质量下降 | push 操作在单主线程（scheduler）完成，draft 只 snapshot 读 |
| Provider 限流 | 中 | 吞吐不升反降 | 默认 concurrency=3；压测后调整；AI SDK 自带 retry |
| Evidence cap 副作用 | 低 | 个别 L2 页变 L1 | metrics 监控 `missing_evidence` 截断次数；必要时调 cap |
| 内存压力 | 低 | OOM | pageConcurrency 硬上限 5；监控 peak RSS |
| Resume 破坏 | 中 | 恢复后数据不一致 | 严格保持 artifact 写入顺序；skipSlugs 按 validate 顺序 |

---

## 10. 预期最终指标

| 项目 | 当前 | Phase 1 后 | Phase 2 后 | 减少 |
|------|------|------------|------------|------|
| repo-read | 9.1h | ~6.5h | **~3.2h** | **−65%** |
| hermes-agent | 17.3h | ~12.3h | **~6.0h** | **−65%** |
| trpc-go（净）| 7.4h | ~5.3h | **~2.6h** | **−65%** |

质量影响：每项目 ~1 页 L2→L1（可以通过 `deepLaneRevisionBonus=1` 局部回退）。

---

## 11. 文件变更总览

### Create

- `packages/core/src/generation/parallel-scheduler.ts`
- `packages/core/src/generation/semaphore.ts`
- `packages/core/src/generation/__tests__/parallel-scheduler.test.ts`
- `packages/core/src/generation/__tests__/semaphore.test.ts`
- `packages/core/src/generation/__tests__/generation-pipeline-parallel.test.ts`

### Modify

- `packages/core/src/config/quality-profile.ts`（新增 3 字段 + 4 preset 默认值）
- `packages/core/src/config/resolver.ts`（resolver 类型更新）
- `packages/core/src/types/config.ts`（如有类型相关）
- `packages/core/src/generation/escalation-policy.ts`（`deepLaneRevisionBonus` 接入）
- `packages/core/src/generation/generation-pipeline.ts`（evidence cap、reviewGate、主循环切 scheduler）
- `packages/core/src/config/__tests__/quality-profile.test.ts`（新字段测试）
- `packages/core/src/generation/__tests__/escalation-policy.test.ts`（deep lane 行为）
- `packages/cli/src/commands/generate.tsx`（`--page-concurrency` flag）

### Explicitly Out Of Scope

- `packages/core/src/generation/evidence-coordinator.ts` 的算法改造
- `packages/core/src/review/*` 的 reviewer 严格度调整
- `packages/core/src/context/*` 的 publishedSummaries schema 改动
- Evidence Fabric 正式实现
- 新的 lane 类型或 escalation 规则
