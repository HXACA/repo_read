# RepoRead 核心 Agent 架构设计文档

> 版本：v4.0
> 更新时间：2026-04-08
> 文档定位：收敛 RepoRead 的 Agent 拓扑、工具协议、上下文策略、模型路由与核心 loop
> 关联文档：
> - [产品需求文档（PRD）](./prd.md)
> - [工程整体设计文档](./design.md)
> - [Zread Tool 与 Agent Loop](./zread_analysis/tool-agent-loop.md)
> - [Prompt 提取索引](./zread_analysis/prompts/prompt-index.md)

---

## 1. 文档目标

本文件只回答四个问题：

1. RepoRead 在运行时到底有几个 Agent。
2. Agent 可以调用哪些工具，以及如何检索、委派、审稿。
3. `catalog`、`page`、`ask`、`research` 四种 mode 分别如何执行。
4. 哪些能力由确定性模块负责，哪些能力保留给模型。

本版是 Task 6 的收口版本，目标是在 Task 5 的收敛基础上补齐角色 prompt、失败处理与三文档术语一致性，保持“单主循环 + 两种委派原语 + 确定性 validator”的边界不扩张。

---

## 2. 设计来源与收敛结论

### 2.1 设计来源

| 来源 | 直接吸收点 |
| --- | --- |
| `claude-code` | 单主控心智、严格工具边界、上下文压缩、审稿与执行分离 |
| `codex` | 本地优先、结构化工具调用、plan/work 分层、角色级模型回退 |
| `opencode` | mode 明确、provider 无关、CLI/Web 双端一致运行 |
| `oh-my-openagent` | 继续执行策略、子任务协作、模型族调优配置 |
| `zread` | `catalog -> page` 的阅读闭环、版本化 Wiki、以页面为中心的读代码体验 |

### 2.2 核心收敛

RepoRead 的 Agent 架构只保留以下结论：

1. 只有一个主控 Agent 实现，名字统一为 `main.author`。
2. 主控只在四种 mode 下工作：`catalog`、`page`、`ask`、`research`。
3. 运行时只保留两种委派原语：`fork.worker`、`fresh.reviewer`。
4. 所有结构与发布校验都交给独立的确定性 `validator`，不再由 Agent 自行兜底解释。
5. 页面生产必须严格串行，单页只能有一个写作者，跨页不能并行写作。
6. 默认先读本地页面与引用，再扩展到仓库检索，最后才落到受限 shell。

### 2.3 不再采用的旧结构

以下设计不再是 RepoRead 的目标状态：

1. 为 `catalog`、`page`、`ask`、`research` 分别维护独立命名 Agent。
2. 在写作者与审稿者之外再增加专门“修复者”。
3. 让审稿模型继承主控的完整写作上下文。
4. 让主控与子任务同时探索同一问题并各自整理证据。

---

## 3. 拓扑总览

```text
Deterministic Runtime
  - Repo Snapshot
  - 实时本地检索
  - validator
  - Publisher
  - Context Store
          │
          ▼
Main Control Loop
  - main.author
    - mode: catalog | page | ask | research
          │
          ├─ fork.worker
          │    - inherited context
          │    - narrow directive
          │    - structured partial result only
          │
          └─ fresh.reviewer
               - fresh session
               - full review briefing
               - review conclusion only
```

### 3.1 角色分工

| 角色 | 类型 | 职责 |
| --- | --- | --- |
| `main.author` | LLM | 唯一主控，负责规划、检索、写作、答问、研究与发布前决策 |
| `fork.worker` | LLM 委派原语 | 在继承父上下文的前提下完成局部检索、局部比对、局部摘要 |
| `fresh.reviewer` | LLM 委派原语 | 在新会话中独立审稿，只输出审稿结论，不参与重写 |
| `validator` | 确定性模块 | 校验 `wiki.json`、页面结构、引用、链接、输出 schema |
| `Publisher` | 确定性模块 | 版本落盘、摘要更新、索引刷新、状态变更 |
| `Context Store` | 确定性模块 | 保存全书摘要、页面计划、已发布页面摘要、证据账本 |

### 3.2 单主循环

“单主循环”指的是：

1. 任一时刻只有一个主控在推进任务状态。
2. 所有 mode 切换都发生在同一个主控会话中。
3. 主控可以委派，但委派不会产生第二个对等控制器。
4. 子任务结束后只返回结构化结果，状态机仍由主控推进。

这意味着 RepoRead 的复杂度不再来自“有多少个命名 agent”，而来自“主控如何在不同 mode 下使用同一套协议”。

---

## 4. 委派原语

### 4.1 `fork.worker`

`fork.worker` 用于低风险、局部化、可并行的工作：

1. 继承父上下文，包括当前页面计划、局部证据、相关检索历史。
2. 只接收窄 directive，例如“检查某个函数链路”“补 3 个缺失引用”“对比两个不重叠目录”。
3. 不得递归委派。
4. 不得改写父计划。
5. 只能返回局部结构化结果，例如命中的文件片段、局部摘要、候选引用列表、局部风险点。

推荐输出形态：

```ts
type ForkWorkerResult = {
  directive: string
  findings: string[]
  citations: Array<{
    kind: 'file' | 'page' | 'commit'
    target: string
    locator?: string
  }>
  open_questions: string[]
}
```

#### 实现接入点：`EvidenceCoordinator`

页面生成主链路通过 `EvidenceCoordinator` 统一调度 `fork.worker`。一个页面的取证循环是：

1. **规划（main.author 调用）** — `EvidencePlanner` 用一次无工具的 LLM 规划调用，把 `page.covered_files` 拆成 N 个有语义的 `EvidenceTask`。N 来自运行时 `QualityProfile.forkWorkers`。若页面 `coveredFiles.length < N` 或 `N === 1`，直接走 fast path 不调 LLM。
2. **并行执行** — `EvidenceCoordinator` 用 `Promise.all` 运行所有 `ForkWorker` 任务，并发上限 = `QualityProfile.forkWorkerConcurrency`。
3. **单任务失败保护** — 任一 worker 抛异常或返回 `success:false` 时，coordinator 重试一次；两次都失败则跳过该 taskId，记入 `failedTaskIds` 并继续用其他 worker 的结果。
4. **汇总** — 合并去重所有 `ForkWorkerResult.citations` → `MainAuthorContext.evidence_ledger`；扁平化所有 `findings` 与 `open_questions` → `MainAuthorContext.evidence_bundle`。
5. **发布事件** — `page.evidence_planned`（任务数 + 是否 fallback）与 `page.evidence_collected`（worker 数 + citation 数 + 失败数），可在 CLI / Web job 页看到。

`main.author` 起草时不再直接跑大量工具检索，而是基于已汇总好的 ledger/findings 写作。这符合第 3.1 节"单主循环 + 委派原语 + 确定性 validator"的边界约束：主控只负责合成与决策，取证的并行化交给 worker 原语。

规划失败时，coordinator 会降级到确定性均分（`coveredFiles.slice()` 切片 + 通用 directive），保证页面仍可推进。

### 4.2 `fresh.reviewer`

`fresh.reviewer` 用于独立审稿：

1. 不继承主控上下文。
2. 必须收到完整 briefing。
3. 允许重新检索本地证据。
4. 只能产出审稿结论，不能直接发布页面。
5. 不负责重新写稿，不负责生成新的页面结构。

推荐输出形态见第 11 节“审稿协议”。

### 4.3 工具层与语义层的关系

运行时暴露 `Agent`、`Task`、`SendMessage` 三个调度工具，但语义上只承认两种委派原语：

| 工具 | 语义用途 |
| --- | --- |
| `Task` | 创建 `fork.worker` |
| `Agent` | 创建 `fresh.reviewer` |
| `SendMessage` | 向子任务发送窄 directive、补充 briefing 或收集结构化结果 |

换言之，`Agent`、`Task`、`SendMessage` 只是 transport，不增加第三种 agent 角色。

---

## 5. 工具清单与检索协议

### 5.1 核心工具

RepoRead 核心工具固定为以下十项：

| Tool | 作用 |
| --- | --- |
| `Read` | 读取文件窗口或指定片段 |
| `Grep` | 文本检索，优先用于快速定位词项与模式 |
| `Find` | 路径发现、目录过滤、文件候选收敛 |
| `Git` | 提供 commit、分支、版本差异与只读历史信息 |
| `Bash` | 仅限白名单的只读命令执行 |
| `Agent` | 创建 `fresh.reviewer` 会话 |
| `Task` | 创建 `fork.worker` 子任务 |
| `SendMessage` | 与子任务交换结构化消息 |
| `PageRead` | 读取已发布页面及其页面元数据 |
| `CitationOpen` | 从页面引用回跳到文件、页面或 commit 证据 |

### 5.2 默认检索顺序

主控与子任务默认遵循固定检索顺序：

`PageRead -> Grep -> Find -> Read -> Git -> Bash`

含义如下：

1. 先读当前页、相关页和已有引用，优先复用已发布知识。
2. 再用 `Grep` 找词项、符号名、配置键、错误文案等。
3. 再用 `Find` 缩小目录或文件集合。
4. 之后才用 `Read` 深读文件窗口。
5. 需要版本、提交或演进信息时再用 `Git`。
6. 只有前述工具不足时，才允许受限 `Bash`。

### 5.3 并行规则

允许：

1. 单页内部多路检索，例如同一页面下并行查找不重叠的候选文件。
2. 局部摘要，例如把多个不重叠证据段落交给 `fork.worker` 分别归纳。
3. 互不重叠文件检查，例如对两个独立目录做覆盖性确认。

禁止：

1. 跨页并行写作。
2. 同页双写者。
3. 主控与子 agent 重复探索同一问题。
4. 一边审稿一边继续改写同一草稿。
5. 让子任务在未收敛范围前自行扩张主题。

### 5.4 工具预算与去重

运行时需要执行以下约束：

1. 同一 mode 内对同一片段的重复读取必须合并到账本。
2. 主控准备委派前，必须先标记“已探索范围”，避免与子任务重复。
3. `Bash` 只能运行只读白名单命令，不允许借道写入或联网。
4. `CitationOpen` 打开的证据必须可以回链到真实文件、页面或 commit。

---

## 6. 上下文与模型配置

### 6.1 用户可配置角色

用户只配置三个角色：

```yaml
roles:
  main.author:
    model: string
    fallback_models: string[]
  fork.worker:
    model: string
    fallback_models: string[]
  fresh.reviewer:
    model: string
    fallback_models: string[]
```

约束：

1. 每个角色仅有 `model` 与 `fallback_models` 两个字段。
2. 不再为 `catalog`、`page`、`ask`、`research` 单独配置不同 agent 名称。
3. mode 选择由运行时决定，不由用户再额外声明角色。

### 6.2 系统内建 prompt 调优

系统按模型族维护系统内建 prompt 调优，而不是把 prompt 细节散落到各 mode：

```ts
type SystemPromptTuningProfile = {
  family: string
  reasoning_style: 'tight' | 'balanced' | 'long-form'
  tool_call_style: 'strict-json' | 'xml-like' | 'freeform-guarded'
  citation_style: 'inline' | 'footnote' | 'ledger-first'
  retry_policy: 'single-reask' | 'fallback-model' | 'abort-fast'
}
```

作用：

1. 统一同一模型族在四个 mode 下的调用语气与输出约束。
2. 把“模型差异适配”从业务协议里剥离出去。
3. 为 `fallback_models` 提供稳定的降级行为。

### 6.3 主控持有的上下文

`main.author` 常驻持有以下上下文：

```ts
type MainAuthorContext = {
  project_summary: string
  full_book_summary: string
  current_page_plan?: string
  published_page_summaries: Array<{
    slug: string
    title: string
    summary: string
  }>
  evidence_ledger: Array<{
    id: string
    kind: 'file' | 'page' | 'commit'
    target: string
    note: string
  }>
}
```

这里的重点不是“保留全部原始证据”，而是保留：

1. 全书摘要。
2. 当前页计划。
3. 已发布页面摘要。
4. 当前证据账本。

### 6.4 子任务上下文边界

`fork.worker`：

1. 继承父上下文。
2. 只接收被裁剪过的局部范围。
3. 只能返回局部结构化结果。

`fresh.reviewer`：

1. 不继承主控上下文。
2. 必须收到完整审稿 briefing。
3. 可以重新检索。
4. 只能输出审稿结论。

### 6.5 模型回退规则

统一规则如下：

1. 先使用角色主模型。
2. 当前模型不满足工具调用或结构化输出要求时，按 `fallback_models` 顺序切换。
3. 切换模型不会改变协议，只改变系统内建 prompt 调优。
4. 回退后仍失败时，由主控终止当前步骤并交给 `validator` 或上层状态机处理。

---

## 7. Catalog Loop

### 7.1 目标

`Catalog Loop` 负责把仓库压缩成严格阅读顺序的 `wiki.json`，而不是产出松散主题列表。

### 7.2 输入

`Catalog Loop` 的最低输入为：

1. 项目摘要。
2. 入口文件。
3. 关键目录。
4. 已有文档。

必要时可以补充：

1. 关键 commit。
2. 现有页面摘要。
3. 人工指定的阅读优先级。

### 7.3 执行顺序

`Catalog Loop` 的主协议：

1. 读取项目摘要与入口文件。
2. 用 `Find` 与 `Grep` 收敛关键目录和核心模块。
3. 对候选阅读路径做最小必要验证性读取。
4. 产出严格顺序的页面列表。
5. 交给 `validator` 校验。
6. 通过后发布 `wiki.json`。

### 7.4 输出要求

输出必须是严格顺序的 `wiki.json`，最小结构如下：

```ts
type WikiJson = {
  summary: string
  reading_order: Array<{
    slug: string
    title: string
    rationale: string
    covered_files: string[]
  }>
}
```

规则：

1. `reading_order` 必须可直接驱动后续页面串行生成。
2. 每个页面都要能回指真实文件集合。
3. 章节只作为概念性分组存在，不进入 Task 5 的协议产物；正式产物只保留扁平 `reading_order`。
4. 禁止出现“其他细节”“杂项”这类不可执行节点。

---

## 8. Page Loop

### 8.1 目标

`Page Loop` 负责按 `wiki.json` 的顺序逐页生成页面，并维持页面级证据闭环。

### 8.2 严格顺序

页面协议固定为：

`plan current page -> retrieve -> draft -> fresh review -> validate -> publish`

解释如下：

1. `plan current page`
   - 主控明确页面目标、边界、章节位置、覆盖文件。
2. `retrieve`
   - 先 `PageRead` 与 `CitationOpen`，再走本地检索顺序。
3. `draft`
   - 只由 `main.author` 产出当前页草稿。
4. `fresh review`
   - 用全新会话独立审稿，输入必须包含 `current_page_plan`，使 reviewer 明确当前页目标与边界。
5. `validate`
   - 由确定性 `validator` 检查结构、引用、链接与 schema。
6. `publish`
   - 发布页面并更新页面摘要。

### 8.3 页面串行约束

页面生成必须满足：

1. 任一时刻只允许一个当前页。
2. 当前页未发布前，不得开启下一页写作。
3. 同一页只能有一个作者，即 `main.author`。
4. `fork.worker` 可以补证据，但不能替代主控写完整草稿。

### 8.4 页面输出

页面草稿至少需要包含：

1. 页面标题。
2. 页面摘要。
3. 正文 Markdown。
4. 引用清单。
5. 关联页面。

引用必须能通过 `CitationOpen` 回跳到文件、页面或 commit。

---

## 9. Ask Loop

### 9.1 目标

`Ask Loop` 用于回答当前用户问题，但默认仍遵循本地优先与页面优先。

### 9.2 执行顺序

`Ask Loop` 的顺序固定为：

1. 先读当前页。
2. 再读当前页引用。
3. 若证据不足，再做本地检索。
4. 必要时补充 `Git` 信息。
5. 输出答案并回链证据。

### 9.3 回答约束

回答必须至少回链到以下一种对象：

1. 文件。
2. 页面。
3. commit。

如果不能回答，必须明确说明：

1. 已检查过哪些本地证据。
2. 还缺什么证据。
3. 是否应升级到 `research`。

---

## 10. Research Loop

### 10.1 目标

`Research Loop` 在 `Ask Loop` 基础上放宽检索深度，用于跨模块因果链、行为比较、版本演进和复杂机制解释。

### 10.2 执行顺序

推荐协议：

1. 复用 `Ask Loop` 的前半段，先读当前页与引用。
2. 形成研究问题和子问题列表。
3. 对每个子问题做更长的本地检索链路。
4. 用 `fork.worker` 处理互不重叠的局部问题。
5. 汇总并标注结论状态。
6. 交给主控输出最终研究结果。

### 10.3 研究输出标注

研究结果必须显式区分：

| 标签 | 含义 |
| --- | --- |
| `事实` | 已由文件、页面或 commit 直接支撑 |
| `推断` | 由多个事实归纳得出，但仍有模型解释成分 |
| `待确认` | 当前本地证据不足，或者存在互相冲突的解释 |

这三个标签必须直接出现在最终输出中，不能隐含。

---

## 11. 审稿协议

### 11.1 审稿输入

`fresh.reviewer` 必须收到完整审稿 briefing。最少输入字段如下：

```ts
type ReviewBriefing = {
  page_title: string
  section_position: string
  current_page_plan: string
  full_book_summary: string
  current_draft: string
  citations: Array<{
    kind: 'file' | 'page' | 'commit'
    target: string
    locator?: string
  }>
  covered_files: string[]
  review_questions: string[]
}
```

审稿问题必须明确，例如：

1. 页面是否越出当前主题范围。
2. 关键结论是否都有证据。
3. 是否遗漏应当覆盖的文件或机制。
4. 当前章节位置是否合理。

其中 `current_page_plan` 用来明确当前页目标、边界、章节位置与预期覆盖点，并与 `Page Loop` 中的 `plan current page` 步骤保持一致。

### 11.2 审稿输出

`审稿输出` 固定为以下结构：

```ts
type ReviewConclusion = {
  verdict: 'pass' | 'revise'
  blockers: string[]
  factual_risks: string[]
  missing_evidence: string[]
  scope_violations: string[]
  suggested_revisions: string[]
}
```

规则：

1. `verdict` 只能是 `pass` 或 `revise`。
2. `blockers` 用于阻止发布。
3. `factual_risks` 只记录事实风险，不混入文风建议。
4. `missing_evidence` 只记录缺失证据点。
5. `scope_violations` 只记录越界内容。
6. `suggested_revisions` 给主控可执行的修改建议。

### 11.3 审稿与改稿的边界

`fresh.reviewer`：

1. 可以重新检索。
2. 可以指出需要补的证据。
3. 不直接重写页面。
4. 不替主控决定是否发布。

是否采纳修改建议、是否再次检索、是否重新起草，全部由 `main.author` 决定。

---

## 12. validator 与发布协议

### 12.1 `validator` 的定位

确定性 `validator` 独立于 Agent，不参与写作、不参与审稿解释，只做判断与报告。

Task 5 中，`validator` 的作用域只收口在 `wiki` / `page` 发布链路，不扩展到 `ask` / `research`。

### 12.2 校验对象

`validator` 至少覆盖：

1. `wiki.json` 的 schema 与顺序完整性。
2. 页面 Markdown 结构。
3. 引用是否可解析。
4. 页面链接是否存在。
5. 页面引用是否能由 `CitationOpen` 回跳。

`ask` / `research` 当前不引入独立 validator 步骤，依赖的是协议约束、引用回链和主控的边界声明。

### 12.3 校验输出

推荐形态：

```ts
type ValidationReport = {
  target: 'wiki' | 'page'
  passed: boolean
  errors: string[]
  warnings: string[]
}
```

如果 `passed = false`：

1. 主控不能跳过校验直接发布。
2. 主控必须先根据错误重试或调整页面。
3. `validator` 自身不生成修正文案。

### 12.4 发布步骤

发布协议固定为：

1. `validator` 通过。
2. `Publisher` 落盘。
3. 更新已发布页面摘要。
4. 刷新目录或引用索引。
5. 将页面加入后续 `PageRead` 可见集合。

---

## 13. Prompt 与协议边界

本节定义三种角色的最小 prompt 模板与行为边界。系统内建 prompt 调优只能在措辞、压缩和工具调用风格上做模型族适配，不能改写这些角色职责。

### 13.1 `main.author` prompt 角色

`main.author` 的角色 prompt 必须固定表达以下职责：

1. 你是唯一作者，也是唯一推进 `catalog`、`page`、`ask`、`research` 主线的角色。
2. 你必须优先复用已发布页面、页面引用和实时本地检索结果，再决定是否继续扩展检索。
3. 你只能基于已核实证据写作；没有证据支撑的内容必须删除、降级为推断，或标记待确认，禁止无证据扩写。
4. 你可以委派 `fork.worker` 做局部取证，也可以调用 `fresh.reviewer` 做独立审稿，但不能把主控决策权交出去。
5. 你负责维护页面计划、证据账本、恢复点和最终发布决策。

### 13.2 `fork.worker` prompt 角色

`fork.worker` 的角色 prompt 必须固定表达以下职责：

1. 你只在主控给定的限定范围内执行证据搜索、局部总结或差异对比。
2. 你必须优先复用主控提供的页面、引用、检索历史和局部计划，不得自行扩展主题。
3. 你禁止重写页面、禁止改写页面计划、禁止产出完整章节草稿。
4. 你禁止递归委派，所有未解决问题都必须回传给 `main.author`。
5. 你的输出只能是结构化局部结果，包括命中证据、局部结论、未解问题和候选引用。

### 13.3 `fresh.reviewer` prompt 角色

`fresh.reviewer` 的角色 prompt 必须固定表达以下职责：

1. 你在全新上下文中审稿，不继承作者会话，不默认相信作者结论。
2. 你必须主动质疑证据不足、边界越界、过度自信、遗漏关键文件或机制的表述。
3. 当 briefing 或引用不足以支持审稿结论时，你必须重新检索本地证据，而不是凭经验放行。
4. 你只能输出审稿结论和修订建议，不能直接重写页面，也不能跳过审稿协议。
5. 你的默认立场是先验证、再通过；证据不够时输出 `revise`，而不是做乐观假设。

### 13.4 角色边界优先级

1. prompt 角色只保留 `main.author`、`fork.worker`、`fresh.reviewer`。
2. 审稿协议、loop 协议、工具边界、输出 schema 的优先级高于 prompt 措辞。
3. 系统内建 prompt 调优只按模型族适配表达方式，不引入新角色、不放宽角色职责。

---

## 14. 失败处理与降级

### 14.1 模型失败与角色级降级

1. `main.author`、`fork.worker`、`fresh.reviewer` 都只能沿各自 `fallback_models` 顺序降级，不能临时串用其他角色。
2. 主模型出现认证失败、能力不足、结构化输出不合格、连续超时或连续工具调用失败时，必须记录失败原因后再切到该角色的下一个 fallback。
3. 切换到 fallback 后，角色职责、输出 schema、检索顺序和审稿要求保持不变，只允许系统内建 prompt 调优随模型族切换。
4. 某角色 fallback 链耗尽后，当前步骤进入失败态，并把失败原因、已完成证据和恢复点交回主状态机。

### 14.2 工具失败与检索重试

1. 工具失败时，主控或子任务必须保留失败上下文，包括当前 query、已探索范围、命中的候选路径和错误信息。
2. 允许在同一职责边界内改写 query 后重试，例如缩小关键词、切换符号名、改走 `Find -> Read`，但不得借重试扩张主题。
3. 工具失败不会清空已收集证据；失败前拿到的页面、引用、文件片段和账本条目必须保留。
4. 若只读白名单 shell 失败，必须回退到更窄的内建工具链，而不是放宽工具权限。

### 14.3 审稿失败与不可跳过规则

1. `fresh.reviewer` 失败不允许跳过，页面不能在无审稿结论的情况下进入 `validator` 或 `publish`。
2. 若 `fresh.reviewer` 主模型失败，必须先走该角色的 fallback 链；fallback 链耗尽时，当前页停留在审稿失败态，等待恢复或重试。
3. 审稿结论为 `revise` 时，必须由 `main.author` 根据问题单补证、改稿并重新发起审稿，不能把旧结论视为已通过。

### 14.4 页面失败与恢复点

1. 页面任一阶段失败时，必须保留当前草稿、最近一次 `fresh.reviewer` 结果、证据账本和当前恢复点。
2. 若失败发生在起草阶段，保留未发布草稿与当前页计划；若失败发生在审稿或校验阶段，同时保留对应 review 或 validation 结果。
3. 已发布页面、已通过页面摘要和 `wiki.json` 不因单页失败而回退。
4. 恢复时必须从最近稳定恢复点继续，默认优先复用已有草稿、review 结果与本地检索上下文，而不是整页重写。

---

## 15. V1 约束与非目标

### 15.1 V1 必做

1. 一个 `main.author` 主控。
2. 两种委派原语：`fork.worker`、`fresh.reviewer`。
3. 独立 `validator`。
4. `catalog`、`page`、`ask`、`research` 四个 loop 协议。
5. 本地优先的页面和仓库检索顺序。

### 15.2 明确不做

1. 重新引入多命名写作者或研究者。
2. 跨页并行写作。
3. 让审稿角色直接写回页面。
4. 把模型族适配写死在业务 prompt 中。

这样收敛后，RepoRead 的运行时边界保持清晰：

1. 主控负责推进状态。
2. 子任务负责局部工作或独立审稿。
3. `validator` 负责确定性把关。
4. 页面与问答都围绕本地证据闭环展开。
