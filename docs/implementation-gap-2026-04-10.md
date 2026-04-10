# RepoRead 实现差异与待办清单

> 快照时间：2026-04-10（P0 批次 + drafter 硬 bug 修复均于当日完成）
> 版本范围：截至 commit `0c10fe0`（drafter 输出提取 + maxOutputTokens + 截断重试）
> 关联文档：
> - [产品需求文档](./prd.md)
> - [Agent 架构](./agent-architecture.md)
> - [2026-04-10 Agent 编排与质量链路 Phase 1-4 计划](./superpowers/plans/2026-04-10-reporead-agent-orchestration-quality.md)
>
> 文档目的：把"设计预期 vs 当前实现"的 gap 落成一份可勾选的待办清单，作为下一阶段的工作起点。不讨论方向是否正确。

---

## 0. 本文档的使用方式

- **A / B / C 节**是差异盘点，每条都带代码位置和严重度标记。
- **D 节**是建议优先级，分 P0/P1/P2 三档，可直接领取。
- **E 节**是验收口径，用来判断一个 P0/P1 项目"做完了"。
- 完成一项后，将对应行前的 `- [ ]` 改成 `- [x]` 并在尾部加 commit hash。
- 新发现的 gap 请追加到对应节，而不是新建文件。

---

## 1. 已完全落地（仅作对齐基准，不需要再动）

这些是主链路，满足 PRD + agent-architecture 核心约束：

| 模块 | 关键文件 | 备注 |
|---|---|---|
| 单主循环 + 双委派原语 | `page-drafter.ts` / `fork-worker.ts` / `reviewer.ts` | 三角色互不混用 |
| Evidence 编排 | `evidence-planner.ts` / `evidence-coordinator.ts` | Phase 1 完成，worker 单次重试+跳过兜底 |
| Quality Profile 4 预设 | `config/quality-profile.ts` | quality/balanced/budget/local-only 已冻结 |
| Reviewer 强制验证 | `review/reviewer.ts` / `reviewer-prompt.ts` | verified_citations 字段 + 不匹配自动升级为 blocker |
| Research 三标签输出 | `research/research-service.ts` + `research-store.ts` | facts/inferences/unconfirmed + 持久化 |
| Pipeline 重试循环 | `generation-pipeline.ts` L216-346 | `page_drafting ↔ reviewing` 状态机 + revisionAttempts 落盘 |
| Resume 能力 | `generation-pipeline.ts` L83-171 + `cli/commands/generate.tsx` L100-190 | `--resume <jobId>`，按 validated meta 快速跳过 |
| 事件流 | `generation-events.ts` | job.*、page.*、evidence.* 全量打点 |
| Web Chat SSE | `ask/ask-stream.ts` + `web/.../ask/route.ts` | fullStream → reasoning/text/tool 事件 |
| 全局配置合并 | `config/loader.ts` | `~/.reporead/config.json` 作为 fallback 层 |
| Publisher 原子发布 | `generation/publisher.ts` | 更新 `project.json.latestVersionId` |
| 渲染层容错 | `web/.../markdown-renderer.tsx` / `toc.tsx` | makeHeadingIdFactory、citation portal、mermaid 修复 |
| **Reviewer 严格度分档** | `review/reviewer-prompt.ts` strictnessRule() | lenient/normal/strict 切换 rule 6 — 2026-04-10 @ `97c943a` |
| **Ask/Research 预设约束** | `ask/ask-stream.ts` + `ask/ask-service.ts` + `research/research-*.ts` | askMaxSteps/researchMaxSteps 全链路生效 — 2026-04-10 @ `97c943a` |
| **Ask 路由实路由分流** | `ask/ask-stream.ts` runStreamingRoute/runResearchRoute | page-first 零工具、research 调 ResearchService — 2026-04-10 @ `97c943a` |
| **Drafter 输出鲁棒化** | `generation/page-drafter.ts` stripDraftOutputWrappers() | 剥离 LLM preamble 和外层 ` ```markdown ` fence — 2026-04-10 @ `0c10fe0` |
| **Drafter token 上限 + 截断重试** | `page-drafter.ts` maxOutputTokens + `generation-pipeline.ts` truncation guard | `finishReason=length` → 合成 revise verdict 跳过 reviewer 直接缩写重写 — 2026-04-10 @ `0c10fe0` |
| **Outline-first 引用映射** | `generation/outline-planner.ts` + pipeline wiring + drafter prompt 消费 | 证据→节映射，drafter 按 outline 写，reviewer 检查密度 — 2026-04-10 @ `5de1ab7` |

---

## 2. 部分落地（Gap 盘点）

### 2.1 Quality Profile 约束链路不完整 ✅ 已闭环

**预期**：`preset` 决定的 QualityProfile 应该贯穿 page 生成 + ask + research 三条路径。

**状态**：**已完成 @ `97c943a`**。

- [x] **G-1** ~~`ask-stream.ts` 未消费 `qualityProfile`~~ [DONE @ `97c943a`]
  - 解决：`AskStreamOptions.qualityProfile` 字段 + `runStreamingRoute` 使用 `askMaxSteps`；page-first 固定 2 步，page-plus-retrieval 使用 profile 预算
  - `AskService`（旧同步版本）也同步接入，CLI `ask.tsx` 传入 `resolvedConfig.qualityProfile`

- [x] **G-2** ~~`reviewerStrictness` 字段定义了但没人读~~ [DONE @ `97c943a`]
  - 解决：`buildReviewerSystemPrompt(minCitations, strictness)` 新增 `strictness` 参数；`strictnessRule()` 函数按 lenient/normal/strict 返回不同的 rule 6 文案
  - `FreshReviewerOptions.strictness` 新增；pipeline 传 `qp.reviewerStrictness`
  - 覆盖测试：`reviewer.test.ts` 三档 strictness 断言 prompt 文本

- [x] **G-3** ~~`research-service.ts` 的 planner/executor/synthesizer 都不接收 qualityProfile~~ [DONE @ `97c943a`]
  - 解决：`ResearchPlanner` / `ResearchExecutor` 新增 `maxSteps` 构造参数（默认 6/15）；`ResearchServiceOptions.plannerMaxSteps` + `executorMaxSteps` 转发
  - CLI `research.tsx` 传入 `resolvedConfig.qualityProfile.researchMaxSteps`（planner 用 ceil/2 的子预算）
  - `QualityProfile` 新增字段：`askMaxSteps`（quality=15 / balanced=10 / budget=4）、`researchMaxSteps`（quality=20 / balanced=15 / budget=8）

### 2.2 Ask 路由判定 → 真实路由执行链路断裂 ✅ 已闭环

**预期**：ask-stream 先用 `classifyRoute` 判定 page-first / page-plus-retrieval / research 三路，不同路由走不同上下文和工具。

**状态**：**已完成 @ `97c943a`**。

- [x] **G-4** ~~路由分类后没有真正分流~~ [DONE @ `97c943a`]
  - 解决：`ask()` 顶层按 route 分支到 `runStreamingRoute(route, ...)` 或 `runResearchRoute(...)`
    - `page-first`：`toolSet = {}`, 2-step 预算，system prompt 追加 page-first guard（"当前页面没有相关内容就说没有，绝不编造"）
    - `page-plus-retrieval`：完整 catalog 工具集 + `qp.askMaxSteps` 预算
    - `research`：完全不走 `streamText`
  - 测试：`ask-stream.test.ts` 三路各一个用例断言 tool 数量 + stepCountIs 实参

- [x] **G-5** ~~research 路由未衔接 `ResearchService`~~ [DONE @ `97c943a`]
  - 解决：`runResearchRoute()` 内部 `new ResearchService({...})` 跑完整 plan→execute→synthesize 管线，持久化 ResearchNote，然后把 `facts/inferences/unconfirmed` 三标签格式化为一段 markdown 通过 `text-delta` 事件流式输出
  - 代价：research 路径不是真正的 token 级流式，UI 会先看到 `tool-call: research.plan` 占位事件，然后一次性接收整段文本。真正 token 流式要侵入每个 sub-step，放到下个迭代
  - 测试：断言 `streamText` 未被调用、`generateText` 被调用、`citations` 事件包含 facts 的引用

### 2.3 Ask Session 持久化不完整 🟡

- [ ] **G-6** AskSessionManager 只有写，没有读
  - 证据：`ask-session.ts:43-49` 有 `persist()` 方法；但构造器 L9 只初始化空 Map，`get()` L25-27 只查内存 Map，**没有 loadFromDisk / listSessions**
  - 影响：进程重启后所有历史 session 都读不出来；Web 和 CLI 无法共享同一 session
  - 严重度：🟡 中 — 落盘文件其实一直在积累但没人用

### 2.4 Evidence 重试策略过被动 🟡

- [ ] **G-7** evidence 只在 reviewer 明确报 `missing_evidence` 时才重新收集
  - 证据：`generation-pipeline.ts:220-223` 的 `shouldCollectEvidence` 条件
  - 影响：当 reviewer 报 `factual_risks` 或 `scope_violations` 时，pipeline 只改 author context 里的 revision 字段，但不重新规划 evidence
  - 严重度：🟡 中 — 理论上可以通过更智能的重规划提升重试质量

### 2.6 Drafter 输出硬 bug（补记）✅ 已闭环

2026-04-10 对 deepwiki-open 产出做 review 时发现的两个硬 bug，P0 批次后立即修完，细节见 `docs/quality-review-2026-04-10.md` §3。

- [x] **G-15** ~~PageDrafter 输出提取不鲁棒~~ [DONE @ `0c10fe0`]
  - 症状：23 页中 11 页（48%）开头带 `Now I have all the necessary information. Let me...` 的 LLM 思维链 preamble，且正文被包在外层 ` ```markdown ... ``` ` fence 里
  - 根因：`page-drafter.ts:parseOutput()` 只处理末尾 JSON 块，没有 strip 开头污染和外层 fence
  - 解决：新增导出函数 `stripDraftOutputWrappers()`，先删掉首个 `# ` heading（或 `` ```markdown `` fence opener）之前的所有内容，再剥掉外层 markdown fence（closer 精确匹配到 `` ```json `` 之前那一个 `` ``` ``，内层代码块不会被误杀）
  - 测试：`page-drafter.test.ts` +6 用例（preamble / 外层 fence / 两者混合 / 内层代码块保留 / stripper 单测 ×4）

- [x] **G-16** ~~Drafter 输出达到 max_tokens 导致内容截断~~ [DONE @ `0c10fe0`]
  - 症状：23 页中 16 页（70%）存在不同程度截断——9 页正文被切掉（包括 mermaid 图中间、代码块中间、半句话），7 页 JSON metadata 被切掉
  - 根因 1：`PageDrafter` 从未给 `generateText` 设过 `maxOutputTokens`，走 Claude 默认 8192，对长页面不够用
  - 根因 2：即使设大一点也仍可能命中，需要一套"截断 → 重写"的机制
  - 解决：
    - `PageDrafterOptions.maxOutputTokens` 默认 16384（2× 默认）
    - 检测 `result.finishReason === "length"` 时给 `PageDraftResult` 打 `truncated: true` 标记
    - `generation-pipeline.ts` 在 draft 返回后判断 `truncated` flag：若还有 revision 预算，合成一个 `verdict: "revise"` 的 reviewResult（blocker = "Page too long, shorten it"），**跳过真实 reviewer**直接回到 `page_drafting` 重写。`missing_evidence: []` 保证不会额外触发 evidence 重收集
    - 因为在 truncation guard 触发时 job 还处于 `page_drafting` 状态，**不需要**额外的 state transition（加了这行会触发状态机 self-transition 错误）
  - 测试：`generation-pipeline.test.ts` +1 用例 `truncated draft triggers shorten-retry without calling reviewer`——8 次 mocked LLM 调用，断言 reviewer 对 overview 页只被真实调用 **一次**（truncated 那次是合成的）

### 2.5 Fresh Reviewer 会话隔离仅靠文档约束 🟡

- [ ] **G-8** FreshReviewer 与 main.author 的会话隔离没有代码防护
  - 证据：`reviewer.ts` 每次 new 一个 `generateText` 调用，但没有 assert 模型 handle 与 author 不同，也没有禁止复用 ai-sdk 的 history
  - 影响：如果上游传入同一个 LanguageModel 实例且模型带隐式历史，可能污染审稿上下文
  - 严重度：🟢 低 — 当前 AI SDK 的 `generateText` 本身就是无状态的，靠 SDK 语义 + ResolvedConfig 分角色兜底

---

## 3. 未开始（设计有但完全没码）

- [ ] **G-9** `repo-read doctor` 诊断命令
  - 预期：检查环境 / 配置 / 不可用模型 / 损坏 jobs / 异常恢复点
  - 来源：`development-backlog.md` B073
  - 优先级：🟡 中 — 提升可调试性

- [ ] **G-10** Web 全库搜索页（page/file/citation 三视图）
  - 来源：`development-backlog.md` B066
  - 优先级：🟢 低 — 不阻塞主链路

- [ ] **G-11** Web 版本切换 widget + 最近阅读记录
  - 来源：`development-backlog.md` B067
  - 优先级：🟢 低

- [ ] **G-12** CLI 流式输出美化（阶段时间线 / 状态栏）
  - 来源：`development-backlog.md` B071
  - 优先级：🟢 低 — 当前纯 `console.log`，长任务时只有"在跑"这一个信号

- [ ] **G-13** SystemPromptTuningProfile 模型族调优
  - 预期：按 {claude / gpt / minimax / local} 分族给不同 system prompt 前缀
  - 来源：`agent-architecture.md` §6.2 + `design-rationale.md` §4.7
  - 现状：`config.ts` 有 `systemPromptTuningId` 字段但所有 prompt builder 都无条件分支
  - 优先级：🟢 低 — 目前 Claude 系列表现已经够用

- [ ] **G-14** Interrupt 语义
  - 预期：主动中断信号 → 保存当前 state → 可 resume
  - 现状：只有被动 fail + resume；没有主动 interrupt 入口
  - 优先级：🟢 低 — resume 已覆盖 90% 场景

---

## 4. 代码超前文档

这些代码已经实现，但 PRD / design docs 没有对应条目。不紧急，但应反写文档避免漂移：

- [ ] **D-1** `evidence-coordinator.ts` 的 `failedTaskIds` 降级策略（worker 失败跳过而非整页失败）→ 补到 agent-architecture §4.1
- [ ] **D-2** `pageMeta.revisionAttempts` 字段 → 补到 design.md 数据模型章节
- [ ] **D-3** `PipelineRunOptions.resumeWith` + `skipPageSlugs` → 补到 prd.md FR-019
- [ ] **D-4** CitationOpen 支持 `commit` kind → 补到 design.md 引用章节，说明何时产出 commit citation

---

## 5. 已知问题与小 bug

- [ ] **B-1** Web 构建告警 `Can't resolve 'keytar'`
  - 位置：`packages/core/src/secrets/secret-store.ts`
  - 成因：keytar 仅 Node.js 可用，Next.js 构建时会尝试解析
  - 修复思路：改成动态 import + 条件守卫 `typeof process !== 'undefined' && process.versions?.node`
  - 严重度：🟡 中 — 只是 warning，不阻塞但污染构建日志

- [ ] **B-2** Resume 跳过页面时不会重新评估预设
  - 位置：`generation-pipeline.ts:180-183`
  - 场景：用户改了 preset 后 resume，已 validated 的页面不会按新预设重跑，但新页面会；造成同一 version 内两种质量标准
  - 严重度：🟢 低 — 属于设计权衡，文档里说清楚就行

- [ ] **B-5** ~~G-1/G-4 原文本描述的硬编码 `stepCountIs(10)` 行号~~ 已失效
  - 历史：P0 前 `ask-stream.ts:125` 硬编码 10 步；P0 后该行不存在了
  - 保留在此只为历史回溯，不需要再处理

- [ ] **B-3** Reviewer 失败无降级
  - 位置：`generation-pipeline.ts:319-326`
  - 场景：reviewer 本身调用失败（网络/模型错）直接 failJob，不会降级成"接受但打标"
  - 严重度：🟡 中 — resume 可以兜，但用户体验差

- [ ] **B-4** `development-backlog.md` / `development-issues.md` 的完成状态过期
  - 现状：两份文档停留在 2026-04-08，Phase 1-4 的落地没有回写
  - 修复思路：一次性把已完成项前加 `[DONE @ <commit>]` 标记
  - 严重度：🟢 低 — 纯文档问题

---

## 6. 下一阶段优先级（D 节）

依据用户诉求"先完善 agent 编排和质量相关的链路"，建议按下面顺序推进。每项的"估算"是粗估，仅作相对比较。

### P0（本轮必做，阻塞"质量链路闭环"）✅ 全部完成 @ `97c943a`

- [x] **P0-1** Ask/Research 接入 QualityProfile（G-1 + G-3）[DONE @ `97c943a`]
  - 实际动作：
    1. `QualityProfile` 新增 `askMaxSteps` + `researchMaxSteps` 字段；四个预设全部补齐
    2. `AskStreamOptions` + `AskOptions`（旧同步版本）都增加 `qualityProfile`；`stepCountIs` 使用 `qp.askMaxSteps ?? 10`
    3. `ResearchPlanner` / `ResearchExecutor` 增加 `maxSteps` 构造参数并在 `generateText` 里加 `stopWhen`
    4. `ResearchService` 增加 `plannerMaxSteps` / `executorMaxSteps`，CLI `research.tsx` 从 qp 传入（planner 用一半预算）
    5. Web `ask/route.ts` + CLI `ask.tsx` 都传 `resolvedConfig.qualityProfile`
  - 验收结果：`quality-profile.test.ts` 断言预算字段存在且 budget≤quality；`ask-stream.test.ts` 断言 budget/balanced preset 下 `stepCountIs` 收到的值与 profile 一致

- [x] **P0-2** Ask 路由真正分流（G-4 + G-5）[DONE @ `97c943a`]
  - 实际动作：
    1. `ask-stream.ts` 顶层 `try { if route === "research" ... else runStreamingRoute(...) }` 拆成两条分支
    2. `runStreamingRoute` 内部按 `isPageFirst` 切换 tool set（`{}` vs 完整）和预算（2 vs askMaxSteps）
    3. `buildSystemPrompt` 在 page-first 时追加 guard rail 段落
    4. `runResearchRoute` 内部 `new ResearchService({...plannerMaxSteps, executorMaxSteps})` 跑完整管线，然后 `formatResearchAnswer` 把三标签格式化后用 `text-delta` 发出
  - 验收结果：`ask-stream.test.ts` 三路各一个用例，断言 `streamText.mock.calls[0][0].tools` 键数、`stepCountIs` 实参、research 路径仅 `generateText` 被调用
  - 已知代价：research 路径不是真正 token 级流式（UI 会"卡一下再整段出现"），留作后续迭代

- [x] **P0-3** Reviewer 消费 `reviewerStrictness`（G-2）[DONE @ `97c943a`]
  - 实际动作：
    1. `reviewer-prompt.ts` 新增 `ReviewerStrictness` 类型 + `strictnessRule()` 函数，切换 rule 6 文案
    2. `FreshReviewerOptions.strictness` 字段（默认 `"normal"`）
    3. `generation-pipeline.ts` 构造 reviewer 时传 `strictness: qp.reviewerStrictness`
  - 验收结果：`reviewer.test.ts` 三档 strictness 用例断言 system prompt 包含/不包含对应关键词（"err on the side of rejection" / "HARD blockers that would actively mislead"）

### P1（下一轮推进）

- [ ] **P1-1** Ask Session 落盘读取（G-6）
  - 动作：`AskSessionManager` 增加 `loadFromDisk(sessionId)` / `list(projectSlug, versionId)`；get() miss 时自动尝试 loadFromDisk
  - 验收：重启进程后能通过 sessionId 继续对话
  - 估算：2h

- [ ] **P1-2** Evidence 智能重规划（G-7）
  - 动作：把 reviewer 反馈里的 `factual_risks` / `scope_violations` 也作为 re-collect 触发条件；在 re-collect 时把反馈文本加入 plan 的 context，引导 planner 产出针对性子任务
  - 验收：重试时能看到新的 evidence ledger 条目覆盖了之前 reviewer 指出的风险点
  - 估算：4-5h

- [ ] **P1-3** Keytar 构建告警修复（B-1）
  - 估算：1h

- [ ] **P1-4** Reviewer 失败降级（B-3）
  - 动作：reviewer 异常时落盘一个"unverified"状态的 review，让 pipeline 继续；下次 resume 时优先重跑这些页的 review 环节
  - 估算：3h

- [ ] **P1-5** `repo-read doctor` 命令（G-9）
  - 估算：3-4h

### P2（可以放到下个迭代）

- [ ] **P2-1** 反写文档（D-1 ~ D-4 + B-4）一次性清理
- [ ] **P2-2** Web 搜索页（G-10）
- [ ] **P2-3** Web 版本切换 widget（G-11）
- [ ] **P2-4** CLI 输出美化（G-12）
- [ ] **P2-5** SystemPromptTuningProfile（G-13）
- [ ] **P2-6** Interrupt 语义（G-14）

---

## 7. 验收口径

判断 P0 批次"做完了"需要同时满足：

1. **代码验收**
   - 对应 G-x 编号的所有文件已改，且 lint/typecheck 通过
   - 新增/修改的行为有对应单元测试或集成测试覆盖
   - `pnpm -w test` 全绿
   - `pnpm -w build` 零告警（B-1 除外直到该项被做）

2. **行为验收**
   - 至少用两种 preset（建议 budget + quality）跑一遍真实 ask 问题，对比输出差异
   - 至少用一次 research 路径生成 ResearchNote 并在文件系统里确认存在
   - 至少用一次跨进程 resume 成功

3. **文档验收**
   - 本文档里对应的 `- [ ]` 改为 `- [x]` 并追加 commit hash
   - 如果引入了新字段或新事件，同步更新 design.md / prd.md / agent-architecture.md 对应小节

---

## 8. 本文档的维护

- **新 gap 出现时**：追加到对应 2.x / 3 / 5 节，不要新建文件
- **完成一项时**：对应行 `- [ ]` → `- [x]`，尾部加 ` [DONE @ abc1234]`
- **每个 Phase 结束**：把本文档"归档"成 `docs/implementation-gap-<date>.md`，再生成下一份
- **快照时间过期超过 2 周**：无论有没有变化，都重新生成一次

---

## 附录 A：当前运行中的相关任务

- Task #86 `Final validation smoke test` — 等待 background resume (job `cd4ff08b-...`) 完成；进度 21/23
- Task #87 `Implement minimal resume` — 已完成，commit `40a1507`
- Task #88 `P0-3: Reviewer consume reviewerStrictness` — 已完成，commit `97c943a`
- Task #89 `P0-1: Ask/Research consume QualityProfile` — 已完成，commit `97c943a`
- Task #90 `P0-2: Ask route dispatch` — 已完成，commit `97c943a`

## 附录 C：P0 批次产出小结（2026-04-10）

| 项目 | 文件 | 测试 |
|---|---|---|
| QualityProfile 扩字段 | `config/quality-profile.ts` +2 字段 | `quality-profile.test.ts` +4 断言 |
| Reviewer strictness | `review/reviewer-prompt.ts` +`strictnessRule()` / `reviewer.ts` +option / `generation-pipeline.ts` 传参 | `reviewer.test.ts` +3 tests |
| Research budget | `research/research-planner.ts` +`maxSteps` / `research-executor.ts` +`maxSteps` / `research-service.ts` +options / `cli/commands/research.tsx` 传参 | 现有 tests 绿 |
| Ask quality profile | `ask/ask-stream.ts` + `ask/ask-service.ts` +option / `web/.../ask/route.ts` / `cli/commands/ask.tsx` 传参 | `ask-stream.test.ts` +3 tests |
| Ask route dispatch | `ask/ask-stream.ts` 拆 `runStreamingRoute` + `runResearchRoute` + `formatResearchAnswer` | 同上 |

**产出统计**：17 files changed, +960 / -73。测试 243 → 249（净增 6：reviewer strictness +3、ask-stream route dispatch +3）。Core / CLI / Web 三包 typecheck 全绿。

## 附录 B：关键数据位置

| 内容 | 路径 |
|---|---|
| Draft 态页面 | `.reporead/projects/<slug>/drafts/<jobId>/<versionId>/pages/<pageSlug>/` |
| 已发布版本 | `.reporead/projects/<slug>/versions/<versionId>/` |
| 事件流 | `.reporead/projects/<slug>/jobs/<jobId>/events.ndjson` |
| Research 笔记 | `.reporead/projects/<slug>/research/<versionId>/<noteId>.json` |
| Ask sessions（落盘但没读） | `.reporead/projects/<slug>/ask/<sessionId>.json` |
| 全局配置 | `~/.reporead/config.json` |
| 项目配置 | `.reporead/projects/<slug>/config.json` |
