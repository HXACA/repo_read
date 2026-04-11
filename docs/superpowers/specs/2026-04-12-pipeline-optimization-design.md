# RepoRead Pipeline 终极优化设计

> Date: 2026-04-12
> Status: Approved
> Sources: architecture-optimization-2026-04-12.md + review-2026-04-12.md
> Test baseline: 318 pass / 0 fail

## 核心设计原则

1. **指针传递 + 按需读取**：每个 pipeline 阶段输出持久化为文件，下游 agent 收到文件路径，用工具按需读取
2. **只向上升级，不向下降级**：preset 是质量地板不是天花板，复杂页面动态加码
3. **差分而非全量**：revision review 只检查上次标注的问题，evidence 补充只跑缺证部分
4. **复杂度只基于结构信号**：不做文本语义推断，不加关键词硬规则

---

## Phase 1：P1 修复 + 工程基础

不依赖架构改动，独立可交付。

### 1.1 凭证路径统一

**问题**：`generate` 有 `env → config.apiKey` fallback，但 `ask`/`research` 只读 env。按 README 配置时 ask/research 报错。

**方案**：
- 新建 `packages/core/src/config/resolve-api-keys.ts`
- 导出 `resolveApiKeys(config: UserEditableConfig): Record<string, string>`
- 逻辑：遍历 `config.providers`，每个 provider 优先读 `process.env[p.secretRef]`，fallback 到 `p.apiKey`
- `generate.tsx`、`ask.tsx`、`research.tsx`、Web `ask/route.ts` 统一调用此函数
- 删除 `generate.tsx` 中自己写的 apiKey 收集逻辑

### 1.2 删除 Web 本地 API key UI

**问题**：浏览器设置面板有 API key 输入框，但不传给服务端，是死配置。

**方案**：
- `settings-context.tsx`：删除 `apiKey` state 和 localStorage 持久化
- `settings-panel.tsx`：删除 API key 输入框
- `chat-dock.tsx`：无需改动（本来就不发 apiKey）
- Web `ask/route.ts`：改用 `resolveApiKeys()` 获取 key

### 1.3 Doctor 检查对齐

**方案**：
- Node 版本检查读 `package.json` 的 `engines.node` 字段，不硬编码 18
- 凭证检查调用 `resolveApiKeys()`，不自己写判断逻辑

### 1.4 Web 字体离线化

**方案**：
- 下载 Crimson Pro / JetBrains Mono / Outfit 字体文件到 `packages/web/public/fonts/`
- `layout.tsx` 从 `next/font/google` 改为 `next/font/local`

### 1.5 ForkWorker 补漏

- 加 `maxSteps` 约束：`QualityProfile` 新增 `workerMaxSteps`（quality=8, balanced=6, budget=4）
- JSON 解析改用共享 `extractJson()` 替代自定义 parser

### 1.6 工程基础

- `package.json` bin 指向 tsx 入口（开发时不依赖 tsc build）
- 新增 config round-trip 测试：所有字段在 Zod parse 后不丢失
- 消除重复 `profileRepo` 调用：CLI 传 profile 给 pipeline
- Drafter/Reviewer/Coordinator 移到 page loop 外创建

**验收**：
- `repo-read ask -q "hello"` 用 config.apiKey 能跑通
- `pnpm build` 离线成功
- `repo-read doctor` 不误报
- ForkWorker 在 step budget 内完成

---

## Phase 2：中间结果持久化 + 指针传递

### 2.1 新增持久化文件

| 阶段 | 文件路径 | 内容 |
|---|---|---|
| Evidence | `<jobDir>/evidence/<slug>.json` | `{ ledger, findings, openQuestions, failedTaskIds }` |
| Outline | `<jobDir>/outline/<slug>.json` | `{ sections: [{ heading, key_points, cite_from }] }` |
| Published Index | `<jobDir>/published-index.json` | `[{ slug, title, summary }]` — 累积更新 |

`StoragePaths` 新增对应路径方法。

### 2.2 Pipeline 改造

Evidence coordinator 完成后 → 写 `evidence/<slug>.json`
OutlinePlanner 完成后 → 写 `outline/<slug>.json`
每页 validate 后 → 更新 `published-index.json`

### 2.3 Agent 改为指针接收

**Drafter**：
- `MainAuthorContext` 不再包含 `evidence_ledger` 和 `evidence_bundle` 的完整内容
- 改为传 `evidence_file: string` 和 `outline_file: string`
- Drafter prompt 指导模型用 `read` 工具按需读取
- `published_page_summaries` 改为传 `published_index_file: string`

**Revision Drafter**：
- 不再截断前一版 draft 塞 prompt
- 传 `draft_file: string` + reviewer 标注的具体问题列表
- Drafter 用 `read` 读 draft 的相关 section，针对性修改

### 2.4 Resume 加速

Resume 时检查 `evidence/<slug>.json` 和 `outline/<slug>.json` 是否存在：
- 存在 → 跳过该页的 evidence collection 和 outline planning
- 不存在 → 正常执行

**验收**：
- `ls <jobDir>/evidence/` 可见每页的 evidence 文件
- Resume 不重跑已有 evidence/outline 的页面
- Debug log 可见 drafter 的 `read` 工具调用

---

## Phase 3：Reviewer 改造 + 差分 Review

### 3.1 Reviewer 文件读取模式

**ReviewBriefing 改造**：
```typescript
type ReviewBriefing = {
  page_title: string;
  section_position: string;
  current_page_plan: string;
  full_book_summary: string;
  draft_file: string;           // 替代 current_draft
  covered_files: string[];
  published_summaries_file: string;  // 新增
  review_questions: string[];
};
```

Reviewer prompt 改为：
1. 先用 `read` 读 draft 文件
2. 对每个 citation，用 `read` 读源文件验证声明是否匹配
3. 用 `read` 读 published index 检查跨页一致性

### 3.2 差分 Review

`ReviewBriefing` 新增可选字段：
```typescript
  previous_review?: {
    verdict: string;
    blockers: string[];
    factual_risks: string[];
    missing_evidence: string[];
  };
  revision_diff_summary?: string;  // 哪些 section 被修改了
```

当 `previous_review` 存在时，reviewer prompt 改为：
```
上次审阅发现以下问题：
[具体问题列表]

作者已修订了 draft。修改涉及的 section：[列表]
请重点检查以上问题是否修复。对未修改的 section 抽样检查 1-2 个。
如果全部修复，verdict=pass。
```

### 3.3 Evidence 增量补充

`EvidenceCoordinator.collect()` 新增参数：
```typescript
type CollectInput = {
  // ... existing fields ...
  existingLedger?: CitationRecord[];  // 新增
  focusAreas?: string[];              // reviewer 标注的缺证领域
};
```

当 `existingLedger` 存在时：
- Planner 只为 `focusAreas` 规划新 worker
- 新结果 merge 进 existingLedger（去重）
- 不替换已有的 evidence

### 3.4 确定性检查

- `page-validator` 增加 citation 密度检查：每个 `##` section 统计 `[cite:` 数量，密度 < 阈值 → warning
- Pipeline validate 阶段：根据 `covered_files` 交集自动计算 `relatedPages`，写入 pageMeta

### 3.5 Drafter prompt 反面模式

System prompt 追加：
```
Do NOT:
- Use "Let's dive in/explore/take a look" openings
- Add summary paragraphs at the end of sections ("In this section, we learned...")
- Convert every paragraph into bullet lists
- Use hedging phrases like "It's worth noting that" or "Interestingly"
```

**验收**：
- Reviewer debug log 可见 `read` 工具调用 draft 文件和源文件
- Revision review 的 prompt 明显更短（只含上次问题 + 重点检查指令）
- Evidence 补充只派新 worker 到缺证领域

---

## Phase 4：页面复杂度评分 + 动态加码

### 4.1 PageComplexityScore

纯结构信号，不做语义推断：

```typescript
type PageComplexityScore = {
  fileCount: number;           // covered_files.length
  dirSpread: number;           // 涉及多少个不同目录
  crossLanguage: boolean;      // covered_files 包含多种语言后缀
  score: number;               // 加权总分
};
```

计算时机：page loop 开始时，在 evidence collection 之前。

### 4.2 动态加码规则

Preset 决定地板值。加码只向上，不向下：

| 信号 | 加码动作 |
|---|---|
| `score` > 阈值 | `forkWorkers` +1, `drafterMaxSteps` +8 |
| reviewer 报 `factual_risks` | 下轮 `workerMaxSteps` +4, evidence focusAreas |
| reviewer 报 `missing_evidence` | 下轮 `forkWorkers` +1 |
| citation 密度低（validation warning）| 下轮 `reviewerVerifyMinCitations` +2 |
| draft 截断 | `maxOutputTokens` +4096 |

阈值和加码幅度从 QualityProfile 读取，可通过 `qualityOverrides` 按项目自定义。

### 4.3 可观测性

Pipeline 事件中记录：
- `page.complexity_scored`: `{ slug, score, fileCount, dirSpread, crossLanguage }`
- `page.params_adjusted`: `{ slug, field, from, to, reason }`

Progress renderer 可展示复杂度分数。

**验收**：
- 简单页（2-3 files, 单目录）和复杂页（10+ files, 跨目录）的实际执行参数不同
- Debug log 可见 complexity score 和参数调整记录
- 总耗时下降但质量不降

---

## 依赖关系

```
Phase 1 (独立)
Phase 2 (独立)
Phase 3 → 依赖 Phase 2（需要持久化的文件）
Phase 4 (独立，但效果受益于 Phase 2/3)
```

建议执行顺序：Phase 1 → Phase 2 → Phase 3 → Phase 4

## 不做的事

- 不做 L0 最低成本快路径（会导致偷懒）
- 不做基于文本语义的复杂度推断（关键词匹配等）
- 不做跨页 evidence 缓存（收益不确定，Phase 4 之后再评估）
- 不做 Web E2E 测试（单独迭代）
- 不做 section-level 单独重写（粒度过细，风险大）
