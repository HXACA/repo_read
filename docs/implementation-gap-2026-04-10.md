# RepoRead 实现差异与待办清单

> 快照时间：2026-04-10
> 版本范围：截至 commit `40a1507`（minimal resume support 合并后）
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

---

## 2. 部分落地（Gap 盘点）

### 2.1 Quality Profile 约束链路不完整 🔴

**预期**：`preset` 决定的 QualityProfile 应该贯穿 page 生成 + ask + research 三条路径。

**实际**：

- [ ] **G-1** `ask-stream.ts` 未消费 `qualityProfile`
  - 证据：`ask-stream.ts:125` 硬编码 `stopWhen: stepCountIs(10)`，`AskStreamOptions` (L10-15) 没有 qualityProfile 字段
  - 影响：budget preset 下 ask 仍跑满 10 步；quality preset 也只有 10 步上限
  - 严重度：🔴 高 — 直接违反 FR-009（预设必须贯穿所有 LLM 调用路径）

- [ ] **G-2** `reviewerStrictness` 字段定义了但没人读
  - 证据：`quality-profile.ts:26,46,55,64,73` 四个预设都声明了该字段；`reviewer.ts` / `reviewer-prompt.ts` 全文无引用
  - 影响：lenient 和 strict preset 下 reviewer 的语气完全一样
  - 严重度：🟡 中 — 功能存在但预设区分度降低

- [ ] **G-3** `research-service.ts` 的 planner/executor/synthesizer 都不接收 qualityProfile
  - 证据：`research-service.ts:57-90` 的 research() 签名只有 (projectSlug, versionId, topic, context?)
  - 影响：research 在任何 preset 下都用全量步数 + 全量工具
  - 严重度：🟡 中

### 2.2 Ask 路由判定 → 真实路由执行链路断裂 🔴

**预期**：ask-stream 先用 `classifyRoute` 判定 page-first / page-plus-retrieval / research 三路，不同路由走不同上下文和工具。

**实际**：

- [ ] **G-4** 路由分类后没有真正分流
  - 证据：`ask-stream.ts:79-86` 调用 `classifyRoute` 并通过 `yield { type: "session", route }` 告诉前端；但 L114 `const tools = createCatalogTools(...)` 三路共用同一工具集；L125 `stepCountIs(10)` 三路共用同一预算；L120-126 三路共用同一 system prompt（仅 `route` 字符串拼进提示文本）
  - 影响：route 只是一个 UI 标签，没有实际语义
  - 严重度：🔴 高 — 路由设计形同虚设

- [ ] **G-5** research 路由未衔接 `ResearchService`
  - 证据：判定为 `research` 后仍然在 ask-stream 内完成；`ResearchService.research()` 没有从任何 ask 上下文被调用
  - 影响：ask 里的"深度问题"永远不会升级成持久化的 ResearchNote
  - 严重度：🟡 中 — 但与 G-4 捆绑处理成本较低

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

### P0（本轮必做，阻塞"质量链路闭环"）

- [ ] **P0-1** Ask/Research 接入 QualityProfile（G-1 + G-3）
  - 动作：
    1. `AskStreamOptions` 增加 `qualityProfile: QualityProfile`
    2. `stepCountIs(10)` → `stepCountIs(qualityProfile.askMaxSteps ?? 10)`（同时在 QualityProfile 加 `askMaxSteps` 字段）
    3. `ResearchService` 的 planner/executor/synthesizer 构造时接收 qualityProfile，控制各自的 maxSteps
    4. Web `ask/route.ts` 和 CLI `ask.tsx` 从 resolvedConfig 取 qualityProfile 传下去
  - 验收：budget preset 下 ask 最多跑 4 步；quality preset 下 ask 最多跑 15 步（或经过验证的值）
  - 估算：3-4h

- [ ] **P0-2** Ask 路由真正分流（G-4 + G-5）
  - 动作：
    1. `classifyRoute` 返回的三路对应不同 system prompt 和工具子集
    2. `page-first` → 不启用 grep/find，只读当前页面，限制 1-3 步
    3. `page-plus-retrieval` → 启用全工具，中等步数
    4. `research` → 改为调用 `ResearchService.research()`，产出 ResearchNote 后流式返回三标签
  - 验收：三路在 Web Chat 里表现明显不同；research 路径能生成落盘的 note
  - 估算：6-8h

- [ ] **P0-3** Reviewer 消费 `reviewerStrictness`（G-2）
  - 动作：
    1. `FreshReviewer` 构造器接收 `strictness: "lenient" | "normal" | "strict"`
    2. `buildReviewerSystemPrompt(minCitations, strictness)` 根据值切换开头语气和容忍度说明
    3. `generation-pipeline.ts` 构造 reviewer 时从 qp 取值传入
  - 验收：三个 preset 跑同一页时 reviewer 输出的 verdict 分布不同（lenient 更多 pass，strict 更多 revise）
  - 估算：2h

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
