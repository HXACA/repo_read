# Mechanism Coverage Guarantee 设计文档

> 时间：2026-04-17
> 状态：已审核，待实施
> 前提：P6b page overlap、quality profile、escalation policy、pc=3 并行调度已上线
> 动机：pc=3 质量 review 发现新管线在 Publisher / `maxEvidenceAttempts` / previous_review 注入等机制上存在系统性遗漏；不是写错了，而是"应该写没写"，需要结构性修复

---

## 0. 问题

三项目真实运行（repo-read / hermes-agent / trpc-go）完成后，对 repo-read 做了 3 对匹配页深度 review（生成管线 / 证据收集 / 审稿验证），结论是：

- 新版技术论断准确（核实 20+ 条 claim 全部对源码准确）
- 但三类机制被静默忽略：
  1. **Publisher 整章消失**（baseline 有专章，新版全篇未提）
  2. **`qp.maxEvidenceAttempts` cap 未文档化**（本次工程优化核心之一，证据页和管线页都没提）
  3. **previous_review 注入机制丢失**（baseline 有专章讲 revision 轮次继承，新版整块消失）

三条共性：源码里明确存在，evidence 也采集到了，但 **drafter 选择性忽略**。

### 根因

当前 pipeline 的三层保障全是软约束：

1. **Catalog 不强制主题完备性**：跨代重规划时可能砍掉重要主题，无报警
2. **Outline 不强制机制枚举**：sections≥2 的 schema 没要求"cover 多少机制"
3. **Reviewer 只检查 precision 不检查 recall**：`missing_evidence` 只在 drafter 有 claim 没证据时触发；drafter 不声称就安全

加速方案（evidence cap + max=3 + pc=3）节省了"重复纠错"的 revision，但不检查 recall，所以**节省的 revision 从未被用来补覆盖**。覆盖问题旧版也存在，只是通过多一轮 revision 偶尔补救。

### 本 spec 的边界

只解决 **B / C / D** 三层（outline / drafter / reviewer 的单次生成闭环）；**A（catalog 跨代主题稳定性）**留作独立下一轮 spec ("Topic Continuity Across Generations"）。

---

## 1. 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 覆盖范围 | B+C+D（outline、drafter、reviewer） | 紧耦合三件事；A 跨代问题独立 |
| Mechanism 数据源 | 复用 evidence ledger | ledger 本就是"值得一提的东西"；零新管线；利用 prefetch/缓存 |
| Ledger 过滤规则 | 只收 `note` 非空的条目 | 纯 citation（无 note）多半是背景引用，不是机制 |
| Target 去重 | 按 `citation.target` 去重 | 同文件 10 条 citation → 1 个 mechanism，避免机械列举 |
| Mechanism 数量上限 | 30 | 超长测试地图页不会因为列表爆炸打乱 outline |
| 覆盖档位 | `must_cite` vs `must_mention` 双档 | must_cite 对应 covered_files 内，must_mention 对应 worker 扩展发现 |
| 触发行为 | Strict（像 missing_evidence 那样触发 revise）| 与现有 factual_risks / scope_violations 一致 |
| Re-draft vs re-evidence | `missing_coverage` 仅 re-draft，不重跑 evidence | ledger 已有信息，漏是 drafter 问题 |
| Rollout | 三档 `off / warn / strict`，Phase 1 默认 warn | 先看数据再严格；保留回退 |

---

## 2. 数据流

```
Evidence Coordinator  →  ledger: LedgerEntry[]
         │
         │  [新增] deriveMechanismList(ledger, coveredFiles)
         │
         ▼
     Mechanism[]
         │
         ├──→ Outline Planner
         │       (sections 必须把每个 mechanism 分配到 covers_mechanisms，
         │        或声明进 out_of_scope_mechanisms)
         │
         ├──→ Drafter (authorContext 注入 mechanism 锚点)
         │
         └──→ Reviewer (L1 / L2)
                 (逐条审核；输出 missing_coverage: string[])

Pipeline 路由（revision 决策）:
   missing_coverage 非空  →  trigger re-draft（不重跑 evidence）
   revision cap 达上限仍有漏  →  页面以 L1 收尾，coverageBlockers 写进 pageMeta
```

---

## 3. 组件设计

### 3.1 Mechanism 类型（新增 `packages/core/src/generation/mechanism-list.ts`）

```typescript
export type Mechanism = {
  id: string;  // "file:packages/core/src/publish/publisher.ts#Publisher"
  citation: { kind: "file" | "page" | "commit"; target: string; locator?: string };
  description: string;  // 来自 ledger.note，截至 120 字
  coverageRequirement: "must_cite" | "must_mention";
};

export function deriveMechanismList(
  ledger: LedgerEntry[],
  coveredFiles: string[],
): Mechanism[] {
  // 1. 过滤：只收 note 非空（trim 后长度 > 0）
  // 2. 按 citation.target 去重（保留第一条）
  // 3. 按 description 长度降序
  // 4. 截断到 30
  // 5. coverageRequirement 判定：target 在 coveredFiles 里 → must_cite，否则 must_mention
  // id 生成：`${kind}:${target}${locator ? `#${locator}` : ""}`
}
```

### 3.2 Outline Planner 改造

#### Schema 变更 (`packages/core/src/types/agent.ts`)

```typescript
type PageOutline = {
  sections: Array<{
    heading: string;
    key_points: string[];
    cite_from: Citation[];
    covers_mechanisms: string[];  // 新增：该 section 声称覆盖的 mechanism ids
  }>;
  out_of_scope_mechanisms: Array<{  // 新增
    id: string;
    reason: string;  // 至少 10 字，通常形如 "在 <other-slug> 展开"
  }>;
};
```

#### Prompt 变更 (`outline-planner.ts`)

给 system prompt 追加 MECHANISMS 段和约束：

```
===== MECHANISMS =====
- [m1] description1
- [m2] description2
...

你的 outline 必须对上面每个 mechanism 做出处理之一：
A. 分配到某个 section 的 covers_mechanisms（该 section 的 key_points 应体现 description）
B. 放入 out_of_scope_mechanisms 并给出 reason

不允许既不 A 也不 B。sections 最少 2 节，最多 8 节。
```

#### Local Validation

```typescript
async plan(input): Promise<OutlineResult> {
  let outline = await this.runLLM(input);
  const missingIds = validateCoverage(outline, input.mechanisms);
  if (missingIds.length > 0) {
    // 1-shot retry: 把漏项追加到现有 outline
    outline = await this.runRetryLLM(input, outline, missingIds);
    const stillMissing = validateCoverage(outline, input.mechanisms);
    if (stillMissing.length > 0) {
      // 兜底：强制塞到最后一个 section，记 warning
      outline = forceAllocate(outline, stillMissing);
      logger.warn(`outline fallback forced ${stillMissing.length} mechanisms`);
    }
  }
  return outline;
}
```

### 3.3 Drafter 改造（最小）

在 `authorContext` 追加：

```
## MECHANISMS TO COVER
- [m1] description1 (requirement: must_cite)
- [m2] description2 (requirement: must_mention)
...

当展开 section 时：
- must_cite: 用 [cite:...] 明确引用该 citation
- must_mention: 至少提到 target 名称或 description 关键词
- outline 标为 out_of_scope 的机制不要在本页展开
```

Revision 分支：从 `reviewResult.conclusion.missing_coverage` 拿漏项列表，在 authorContext 里额外强调。

### 3.4 Reviewer 改造

#### Schema 变更 (`ReviewConclusion`)

```typescript
type ReviewConclusion = {
  verdict: "pass" | "revise";
  blockers: string[];
  factual_risks: string[];
  missing_evidence: string[];
  scope_violations: string[];
  missing_coverage: string[];  // 新增：未覆盖的 mechanism ids
  suggested_revisions: string[];
  verified_citations?: VerifiedCitation[];
};
```

#### Prompt 变更（L1 + L2 共用，在 reviewer-prompt.ts 中）

```
===== MECHANISMS TO VERIFY =====
- [m1] description1 (requirement: must_cite)
...
(已过滤：out_of_scope 项不出现在此列表)

对每个 mechanism：
- requirement=must_cite：draft 里有 [cite:...] 明确引用其 citation 才算覆盖
- requirement=must_mention：draft 文字里至少提到 target 名称或 description 关键词
未覆盖的加入 missing_coverage。missing_coverage 非空时 verdict=revise。

原则：这不要求所有机制"同等展开"，只要求"存在感"。
若某机制不适合本页，应在 outline 阶段标 out_of_scope，不应在 draft 里静默省略。
```

#### Parse 防御 (`reviewer.ts` / `l1-semantic-reviewer.ts`)

`missing_coverage` 默认 []；只接受 `string[]`，其他形状回落为 []；missing_coverage 非空 → 自动升级进 blockers（前缀 "[coverage] "）。

#### VerificationLadder merge

`missing_coverage` 合并策略：L0 空（validator 不参与 coverage）；L1/L2 取并集去重；短路判定和 `missing_evidence` 对称。

### 3.5 Pipeline 路由改造

#### Mechanism 派生时机

```typescript
// 在 outline 之前，evidence 刚完成后
const mechanisms = deriveMechanismList(
  evidenceResult.ledger,
  page.covered_files,
);
```

prefetch 路径里，`page-prefetcher.ts` 也派生并持久化到 prefetch artifacts；主 pipeline 读 prefetch 时直接复用。

#### Revision 触发条件

```typescript
const hasEvidenceIssues =
  (reviewResult?.conclusion?.missing_evidence?.length ?? 0) > 0 ||
  (reviewResult?.conclusion?.factual_risks?.length ?? 0) > 0 ||
  (reviewResult?.conclusion?.scope_violations?.length ?? 0) > 0;

const hasCoverageGap =
  qp.coverageEnforcement === "strict" &&
  (reviewResult?.conclusion?.missing_coverage?.length ?? 0) > 0;

const needsRevision = hasEvidenceIssues || hasCoverageGap;

// re-collect 独立判定（保留现有 cap）
const shouldCollectEvidence =
  coordinator !== null &&
  evidenceCollectionCount < qp.maxEvidenceAttempts &&
  ((attempt === 0 && !evidenceResult) ||
   (attempt > 0 && hasEvidenceIssues));
```

**关键不变量：**
- coverage gap **不**触发 evidence re-collect
- coverage gap **只**在 `strict` 模式下触发 revision（warn / off 模式下只记录）

#### 最终 pageMeta

revision cap 耗尽仍漏项：

```typescript
pageMeta.coverageBlockers = finalReview.conclusion.missing_coverage ?? [];
// reviewStatus 保持既有逻辑 ("accepted" / "accepted_with_notes")
```

### 3.6 QualityProfile 新字段

```typescript
type QualityProfile = {
  // ...existing...
  coverageEnforcement: "off" | "warn" | "strict";
};

// 预设
quality:    { ...existing, coverageEnforcement: "warn" },    // Phase 1 默认
balanced:   { ...existing, coverageEnforcement: "off" },
budget:     { ...existing, coverageEnforcement: "off" },
"local-only":{ ...existing, coverageEnforcement: "off" },
```

三档语义：

| 档位 | deriveMechanismList | 传给 outline/drafter/reviewer | revision 触发 |
|------|---------------------|-------------------------------|--------------|
| off | 跳过 | 不传 | 不触发 |
| warn | 派生 | 传（含 reviewer） | 不触发，但 metrics 记录漏项 |
| strict | 派生 | 传 | `missing_coverage` 非空 → revise |

### 3.7 CLI flag

```
--coverage-enforcement <off|warn|strict>   覆盖 qp.coverageEnforcement
```

### 3.8 Throughput Metrics

```typescript
type PageThroughputRecord = {
  // ...existing...
  coverage?: {
    totalMechanisms: number;
    outOfScopeMechanisms: number;
    unresolvedMissingCoverage: number;  // 终态仍漏的数量
    coverageDrivenRevisions: number;   // 因 coverage 触发的 revision 次数
  };
};

type ThroughputReport = {
  // ...existing...
  coverageAudit: {
    totalMechanismsJob: number;
    unresolvedJob: number;
    pagesWithCoverageGap: string[];
  };
};
```

---

## 4. 测试策略

### 4.1 单元测试

| 模块 | 用例 |
|------|------|
| `deriveMechanismList` | 空 ledger / 5 带 note + 3 空 / 同 target 多 locator / >30 截断 / coveredFiles 内外 requirement 正确 |
| Outline local validation | 漏项触发 retry / retry 失败走 fallback / out_of_scope 正确剔除 |
| Reviewer parse | `missing_coverage` 默认 [] / 非 string[] 回落 / 非空自动升级 blockers |
| VerificationLadder merge | L1+L2 并集去重 / L0 空 / short-circuit 符合 `missing_evidence` 对称规则 |

### 4.2 集成测试（mock LLM）

1. **happy path**：3 mechanisms 全部首稿覆盖 → page.validated，0 coverage-driven revision
2. **coverage-triggered revision**：首稿漏 1，revision 1 补上 → `coverageDrivenRevisions=1`, `unresolvedMissingCoverage=0`
3. **coverage + evidence 同时**：re-draft + re-collect 同发生，`evidenceCollectionCount` 只因 missing_evidence 增
4. **revision cap 耗尽**：3 轮仍漏 1 → 页面发布，`coverageBlockers=[m3]`
5. **off 模式**：完全不派生 mechanism，revision 行为等价旧管线
6. **warn 模式**：reviewer 返 `missing_coverage` 但 `needsRevision` 不因它为 true；metrics 记录

### 4.3 端到端（repo-read 自身跑）

- 跑 `--preset quality`（默认 warn）：检查 `throughput.json.coverageAudit` 至少捕捉到 1 个显著漏项（Publisher / maxEvidenceAttempts 应出现）
- 跑 `--coverage-enforcement strict`：对比 warn 的 wall time 增幅（预期 +10-20%）、`unresolvedJob` 应接近 0
- 人工抽查 review-validation 页是否重新提到 Publisher；evidence 页是否重新提到 `maxEvidenceAttempts`

---

## 5. 分阶段落地

### Phase 1: Soft rollout（2-3 天实施 + 1 天 warn 观察）

- 实现全部代码 + 测试通过
- quality preset 默认 `coverageEnforcement: "warn"`
- 跑 repo-read（自身）、hermes-agent、trpc-go，看 `coverageAudit` 数据
- 期望：每 job `unresolvedJob` 有个位数到两位数、`pagesWithCoverageGap` 非空

### Phase 2: Strict rollout（Phase 1 数据健康后）

- 把 quality preset 切到 `"strict"`
- CLI flag 提供 per-run override
- 在三项目再跑一轮，对比：
  - wall time（vs pc=3 baseline）
  - `accepted_with_notes` 比例
  - `unresolvedJob`（应 ≈ 0）
- 人工抽检：Publisher / maxEvidenceAttempts 是否出现在文档里

### Phase 3（可选）：稳定后把 `"strict"` 作为 quality 默认

balanced/budget/local-only 保持 `"off"`（不值得额外开销）。

---

## 6. 回退策略

三层独立：

| 层 | 操作 | 影响 |
|----|------|------|
| 配置 | `qp.coverageEnforcement = "off"` | 完全禁用，等价旧管线 |
| CLI | `--coverage-enforcement off` | 单次运行 override |
| 代码 | `git revert` 相关 commits | 彻底移除 |

`"off"` 模式行为：
- `deriveMechanismList` 被跳过
- outline schema 仍含新字段，但 `covers_mechanisms=[]`、`out_of_scope_mechanisms=[]`
- drafter 不注入 MECHANISMS TO COVER 段
- reviewer 不走 coverage 检查
- pipeline 不把 coverage 加入 revision 触发
- Throughput `coverage` 字段为 `undefined`

---

## 7. 风险清单

| 风险 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| Outline retry + fallback 增加 outline 阶段 LLM 调用 | 中 | +1-2 LLM call/页（只在漏项时） | `warn` 模式下可观测实际 retry 率 |
| Reviewer 误判（把已提及的机制标为漏） | 中 | 无效 revision 浪费时间 | prompt 里明确 "至少提及 target 名称或 description 关键词就算覆盖" |
| `maxRevisionAttempts=3` 被 coverage-driven revision 吃光，后续真正的 factual_risks 没机会 revise | 低 | 某些页 factual 质量下降 | metrics 里 `coverageDrivenRevisions` 单独计数便于诊断；必要时调高 cap |
| Mechanism list 上限 30 造成长测试地图页漏检 | 低 | 大测试页某些机制未被审查 | warn 模式下观察实际分布；如有必要按 page kind 差异化上限 |
| Prefetch 路径 mechanism 与主路径不一致 | 低 | 偶发 reviewer 检查的清单与 drafter 拿到的不一致 | 统一派生函数 `deriveMechanismList`；prefetch 和主路径都调用同一函数 |
| Outline retry 形成死循环 | 低 | 单页 outline 阶段 hang | retry 固定 1 次；仍失败走 forceAllocate 兜底 |

---

## 8. 预期收益（估算）

| 项目 | pc=3 baseline | +coverage(warn) | +coverage(strict) |
|------|--------------|-----------------|-------------------|
| repo-read wall | 3.58h | 3.6-3.8h (+3%) | 3.9-4.4h (+10-20%) |
| 关键机制覆盖 | 漏 3+（Publisher 等） | 同 baseline，但 metrics 标出 | 回归到 baseline 之前水平 |
| accepted_with_notes | 62% | 62% | 65-70% |

---

## 9. 文件改动总览

### Create

- `packages/core/src/generation/mechanism-list.ts`
- `packages/core/src/generation/__tests__/mechanism-list.test.ts`
- `packages/core/src/generation/__tests__/coverage-integration.test.ts`

### Modify

- `packages/core/src/config/quality-profile.ts`（新增字段 + 4 preset）
- `packages/core/src/config/__tests__/quality-profile.test.ts`
- `packages/core/src/types/agent.ts`（`PageOutline` 扩展）
- `packages/core/src/generation/outline-planner.ts`（输入、prompt、retry、fallback）
- `packages/core/src/generation/__tests__/outline-planner.test.ts`
- `packages/core/src/generation/page-drafter.ts`（authorContext 注入）
- `packages/core/src/generation/page-drafter-prompt.ts`
- `packages/core/src/review/reviewer-prompt.ts`（prompt + schema）
- `packages/core/src/review/reviewer.ts`（parseOutput + 升级 blockers）
- `packages/core/src/review/l1-semantic-reviewer.ts`
- `packages/core/src/review/verification-ladder.ts`（merge）
- `packages/core/src/generation/generation-pipeline.ts`（派生调用点 + 路由 + metrics 填充）
- `packages/core/src/generation/throughput-metrics.ts`（新增字段）
- `packages/core/src/generation/page-prefetcher.ts`（prefetch 也派生）
- `packages/core/src/artifacts/artifact-store.ts`（`coverageBlockers`）
- `packages/cli/src/commands/generate.tsx`（`--coverage-enforcement` flag）

### Out of Scope

- Catalog planner 主题稳定性（独立下一轮 "Topic Continuity Across Generations"）
- Evidence recall 保障（独立 "Evidence Coverage Audit"）
- Mechanism 重要性细粒度（critical / optional）
- 跨页 mechanism 协同（out-of-scope 声称"在 page X 展开"时真的检查 page X）
- Web UI 漏项呈现
- 非 LLM 符号抽取（AST / 多语言）

---

## 10. 与既有优化的兼容

- **`maxEvidenceAttempts` cap**：coverage gap 不增加 `evidenceCollectionCount`，与 cap 无冲突
- **`deepLaneRevisionBonus=0`**：coverage 额外 revision 仍受 `maxRevisionAttempts` 限制
- **`pageConcurrency=3`**：mechanism 派生纯 per-page，无跨页共享状态，天然并行安全
- **P6b prefetch**：prefetch 里也派生 mechanism 并持久化，主路径直接复用，无额外 LLM 调用

本 spec 是对前两轮工程优化的**质量兜底**，不冲突、不对抗。
