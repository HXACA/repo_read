# P6b: Page Overlap Scheduler 设计文档

> 时间：2026-04-14
> 状态：已审核，待实施
> 前提：P0-P7 已完成，pipeline 是纯业务编排器，吞吐指标体系已就绪

---

## 0. 这份文档解决什么问题

当前 generation pipeline 的 page loop 是纯串行：page[i] 全部完成（evidence → outline → draft → review → validate → publish）后才开始 page[i+1]。这意味着 page[i] 在 review 阶段时，page[i+1] 的 evidence/outline 完全空闲。

P6b 的目标是：**page[i] 进入 review 时，提前启动 page[i+1] 的 evidence + outline 采集**，通过磁盘 artifact 隐式通信，让正式 workflow 复用预取结果。

不做通用 DAG，不做任意并行，只做固定的两阶段 overlap。

---

## 1. 设计决策（已确认）

| 决策 | 选择 | 理由 |
|------|------|------|
| 并发上限 | overlap=1，最多 1 个 prefetch | 简单、可预测、provider 压力最小 |
| prefetch 失败处理 | 静默吞掉，正式执行时重跑 | prefetch 是投机性优化，失败不影响正确性 |
| 产物通信方式 | 复用磁盘 artifact 路径 | 现有 resume 逻辑自动加载，零耦合 |
| 启动时机 | page[i] 进入 review 阶段时 | overlap 窗口最大（review 30s-2min） |
| publishedSummaries tradeoff | 接受缺少当前页 summary | v1 已知限制，通过 metrics 监控重复率 |

---

## 2. 核心类型

### PrefetchSlot

```typescript
type PrefetchSlot = {
  pageSlug: string;
  promise: Promise<void>;
  status: "running" | "done" | "failed";
  phases: {
    evidence?: PhaseMetric;
    outline?: PhaseMetric;
  };
  artifactsReady: {
    evidence: boolean;
    outline: boolean;
  };
  error: string | null;
};
```

- `phases` 按 evidence / outline 分开记录，不压成单个总量
- `artifactsReady` 标记哪些 artifact 已成功写入磁盘，供 `runPageWorkflow` 精确判断该继承还是重跑
- `status` 用于失败兜底路径判断

### PageThroughputRecord 扩展

```typescript
// 新增到 PageThroughputRecord
prefetch?: {
  hit: boolean;           // 至少一个 prefetched artifact 被正式 workflow 使用
  waitMs: number;         // 正式 workflow 等 prefetch 完成花了多少 ms（0 = 已完成）
  phases: {               // 诊断镜像，不参与 totals 聚合
    evidence?: PhaseMetric;
    outline?: PhaseMetric;
  };
};
```

### ThroughputReport 扩展

```typescript
// 新增到 ThroughputReport
prefetchHitRate: number;
orphanedPrefetch?: {
  phases: {
    evidence?: PhaseMetric;
    outline?: PhaseMetric;
  };
};
```

---

## 3. 硬约束

### 3.1 startPrefetch() 必须对输入做快照

`publishedSummaries` 是共享可变数组。启动 prefetch 时必须浅拷贝：

```typescript
const snapshotSummaries = [...publishedSummaries];
```

不能传共享引用，否则后续 `publishedSummaries.push(...)` 会让 prefetch 的输入变成不确定行为。当前页的 summary 不在快照内，这是已知 tradeoff。

### 3.2 每个 next page 只允许启动一次 prefetch

用 `Set<string>` 记录已启动 prefetch 的 slug。revision loop 内可能多次进入 review，但不允许重复启动同一个 page 的 prefetch：

```typescript
if (!prefetchedSlugs.has(nextPage.slug)) {
  prefetchedSlugs.add(nextPage.slug);
  activePrefetch = startPrefetch(nextPage, ...);
}
```

### 3.3 page[i+1] 正式开始前必须 await prefetch

这是正确性要求，不是安全边际。`StorageAdapter.writeJson()` 不是原子写（无 temp-file + rename），读到半截 JSON 会导致解析错误。

```typescript
if (activePrefetch) {
  const waitStart = Date.now();
  await activePrefetch.promise.catch(() => {});
  prefetchWaitMs = Date.now() - waitStart;
}
```

### 3.4 prefetch 用轻量 profile

强制 `forkWorkers=1, forkWorkerConcurrency=1`，无论 quality profile 怎么配。prefetch 是投机性的，不应该和当前页的 reviewer/drafter 抢 provider 配额。

### 3.5 prefetch.phases 是诊断镜像，不参与 totals 二次累加

正式页命中 prefetch 后，真实成本回填进 `page.phases.evidence` / `page.phases.outline`。`page.prefetch.phases` 只用于观测 hit/wait 分析，`ThroughputReportBuilder.finish()` 在计算 totals 时**不遍历** `prefetch.phases`。否则同一笔 LLM 成本会被计入两次。

### 3.6 orphanedPrefetchCost 保持 per-phase 分辨率

job 失败时，未被消费的 prefetch 成本记录到 `throughput.orphanedPrefetch`，保持 `phases.evidence` / `phases.outline` 分开：

```typescript
orphanedPrefetch?: {
  phases: {
    evidence?: PhaseMetric;
    outline?: PhaseMetric;
  };
};
```

不压成单个 `PhaseMetric`，保留 phase 级别诊断能力。

### 3.7 PagePrefetcher 不走正式事件流

硬约束：

- ✅ 写 artifact（`artifactStore.saveEvidence` / `saveOutline`）
- ✅ 写 debug log（`REPOREAD_DEBUG` 路径）
- ❌ 不调 `emitter.pageEvidencePlanned` / `pageEvidenceCollected`
- ❌ 不调 `jobManager.transition` / `updatePage`
- ❌ 不改 job state
- ❌ 不触发任何 page lifecycle event

prefetch 对 UI 和 events.ndjson 完全不可见。正式 workflow 命中 prefetch artifact 后，由正式 workflow 自己发事件。

### 3.8 不 prefetch 已跳过的页（resume 保护）

`startPrefetch` 的前置条件必须包含 `!skipSlugs.has(nextPage.slug)`。resume 场景下 `skipSlugs` 包含已验证页，对这些页发起 prefetch 最轻是白跑，最坏是覆盖已验证页的 artifact。

### 3.9 磁盘 artifact 是唯一正确性来源，slot 只负责诊断

`runPageWorkflow` 判断"是否跳过 evidence/outline 采集"的依据是 **disk 上是否成功加载到 artifact**（`artifactStore.loadEvidence` / `loadOutline`），不是 `slot.artifactsReady`。slot 只用于：

1. 补充 phase metrics（区分 prefetch 成本 vs 上次 job 的真复用）
2. 记录 hit / waitMs 诊断信息

如果 slot 说 ready 但 disk 加载失败（理论上不应发生，但防御性编程），以 disk 为准，正常重跑。

---

## 4. 数据流

```
pipeline loop 入口:
  activePrefetch: PrefetchSlot | null = null
  prefetchedSlugs: Set<string> = new Set()

  for (page[i] in reading_order):
    // 正式开始前：等上一轮 prefetch 完成
    if (activePrefetch?.pageSlug === page.slug):
      await activePrefetch.promise.catch(() => {})
      prefetchWaitMs = ...
      slot = activePrefetch
      activePrefetch = null

    runPageWorkflow(page[i], { prefetchSlot: slot })
      → resume 逻辑检查 disk artifact（loadEvidence / loadOutline）
      → 磁盘成功加载是唯一正确性来源：
          if (disk 上有 evidence):
            跳过采集
            if (slot?.artifactsReady.evidence):
              evidenceMetric = slot.phases.evidence  // 继承 prefetch 真实 cost
            else:
              evidenceMetric = { reused: true, llmCalls: 0 }  // 来自上次 job 的真复用
          else:
            正常采集（无论 slot 怎么说）
      → outline 同理

      → draft → review cycle:
          // 在 review 调用前
          if (nextPage exists
              && !prefetchedSlugs.has(nextPage.slug)
              && !skipSlugs.has(nextPage.slug)):  // resume 保护：不 prefetch 已验证页
            prefetchedSlugs.add(nextPage.slug)
            activePrefetch = startPrefetch(nextPage, {
              publishedSummaries: [...publishedSummaries],  // 快照
              forkWorkers: 1,
              forkWorkerConcurrency: 1,
            })
      
      → validate → publish → push summary

  // job 成功后：清理
  if (activePrefetch):
    await activePrefetch.promise.catch(() => {})
    // 未被消费的 prefetch 成本 → orphanedPrefetch
```

---

## 5. 时间轴示意

```
正常串行:
  Page1: [evi][out][draft][review][val][pub]
  Page2:                                    [evi][out][draft][review][val][pub]
  总耗时: ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

P6b overlap:
  Page1: [evi][out][draft][review][val][pub]
  Page2:                   ↑      [evi][out].[draft][review][val][pub]
                     prefetch 启动   ↑ await      ↑ 命中 prefetched artifact
  总耗时: ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                                         ↑ 节省了这段
```

---

## 6. 指标定义

### prefetchHitRate

```
分子：至少命中一个 prefetched phase 的页面数
分母：实际发起过 prefetch 的页面数（不含跳过的页面）
```

不用总页数做分母，避免被未 prefetch 的页面稀释。

### prefetchWaitMs

正式 workflow await prefetch promise 花费的时间。0 表示 prefetch 已经在主流程开始前完成（理想状态）。该值越高说明 prefetch 还没跑完主流程就到了 —— overlap 收益越低。

---

## 7. 文件改动

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/generation/page-prefetcher.ts` | 新增 | PrefetchSlot 类型 + startPrefetch() 函数 |
| `src/generation/page-prefetcher.test.ts` | 新增 | prefetch 成功/失败/metrics 测试 |
| `src/generation/generation-pipeline.ts` | 修改 | for 循环加 prefetch 调度 + await + 失败兜底 |
| `src/generation/generation-pipeline.ts:runPageWorkflow` | 修改 | 接收 prefetchSlot?，按 artifactsReady 继承 per-phase metrics |
| `src/generation/throughput-metrics.ts` | 修改 | PageThroughputRecord 加 prefetch? 字段，Report 加 orphanedPrefetch + prefetchHitRate |

---

## 8. 测试策略

1. **page-prefetcher 单测**
   - evidence + outline 成功 → artifactsReady 全 true，phases 有值
   - evidence 成功 outline 失败 → artifactsReady 部分 true
   - 全部失败 → status=failed，error 有值，不 throw

2. **pipeline 集成测**
   - 2 页场景：page[1] 的 evidence/outline metric 标记 prefetched
   - prefetch 失败场景：page[1] 正常从头采集，metrics 无异常
   - job 失败场景：orphanedPrefetchCost 被记录

3. **metrics 测试**
   - prefetch.phases 不参与 totals 累加
   - prefetchHitRate 计算正确

---

## 9. 已知 tradeoff

1. **publishedSummaries 缺当前页** — prefetch 在 review 阶段启动，当前页 summary 还没 push。v1 接受，后续通过 cross-page duplication rate 监控。

2. **overlap 窗口可能不够** — 如果 review 很快（L0 deterministic only），prefetch 来不及完成，主流程会 await 等待。prefetchWaitMs 可诊断。

3. **轻量 profile 降低 prefetch 质量** — forkWorkers=1 意味着 evidence 覆盖面可能不如正式采集。但 prefetch 只是预取，正式 workflow 的 reviewer 会在后续轮次补齐。
