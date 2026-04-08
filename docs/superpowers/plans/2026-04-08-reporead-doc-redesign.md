# RepoRead Core Docs Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重写 `docs/prd.md`、`docs/design.md`、`docs/agent-architecture.md`，使其完整反映已确认的 RepoRead 重设计方向，并把 spec 扩展成可直接执行的正式文档包。

**Architecture:** 先改 `PRD`，锁定产品定位、范围、体验和质量门槛；再改 `design`，把轻量清单、实时本地检索、严格串行流水线、Web/CLI、Provider 和测试方案写成可开发设计；最后改 `agent-architecture`，把 runtime 收敛为单主循环、两种委派原语和确定性校验器，并补足工具、并行、审稿、模型降级和 prompt 调优细节。最后做一次跨文档一致性校验，确保三份文档术语、能力边界和运行语义完全对齐。

**Tech Stack:** Markdown, `rg`, `sed`, `git`, 本地文档校验命令

---

## File Map

- Modify: `docs/prd.md`
  - 责任：产品定位、用户旅程、功能范围、Web/CLI 体验、质量原则、发布门槛
- Modify: `docs/design.md`
  - 责任：工程整体设计、目录结构、落盘协议、实时本地检索、严格串行生成、接口与测试方案
- Modify: `docs/agent-architecture.md`
  - 责任：主控 Agent runtime、`fork worker` / `fresh reviewer` 语义、工具清单、并行规则、上下文与模型策略
- Read: `docs/superpowers/specs/2026-04-07-reporead-agent-redesign-design.md`
  - 责任：本轮改写的约束来源，不允许偏离
- Reference: `docs/zread_analysis/tool-agent-loop.md`
  - 责任：保留 zread 可借鉴点，并明确超越点
- Reference: `docs/zread_analysis/web-capabilities.md`
  - 责任：补强 Web/CLI 与阅读体验设计

## Execution Rules

- 只改上述三份主文档，不在本轮新增新的正式设计文档
- `PRD -> Design -> Agent Architecture -> Cross-check` 严格串行执行
- 每个任务结束后都运行命令校验，再提交一次小 commit
- 文档中不允许出现以下方向：
  - `RAG`
  - `embedding`
  - `向量检索`
  - `SQLite`
  - 以分钟为核心的硬性时间承诺
- 文档中必须出现以下方向：
  - `质量优先`
  - `严格串行`
  - `轻量清单`
  - `实时本地检索`
  - `fork worker`
  - `fresh reviewer`
  - `系统内建 prompt 调优`

### Task 1: 重写 PRD 的产品定位、边界与目标

**Files:**
- Modify: `docs/prd.md`
- Read: `docs/superpowers/specs/2026-04-07-reporead-agent-redesign-design.md`
- Reference: `docs/zread_analysis/README.md`
- Test: `docs/prd.md`

- [ ] **Step 1: 运行基线扫描，确认旧表述仍然存在**

Run: `rg -n 'RAG|SQLite|向量|embedding|时间指标' docs/prd.md`
Expected: 至少命中 1 处旧表述，证明文档确实需要改写。

- [ ] **Step 2: 重写 `docs/prd.md` 的第 1 到第 6 节，明确新产品定义**

将 `docs/prd.md` 的开头至“目标形态与分期”部分改成以下结构与内容：

```md
# RepoRead 产品需求文档（PRD）

## 1. 文档目标
本文档定义 RepoRead 的正式产品需求。RepoRead 的目标不是做一个重 RAG、重多 Agent 的平台，而是做一个本地优先、质量优先、以代码阅读和技术书写为核心能力的工作台。

## 2. 产品背景
### 2.1 当前机会
Zread 证明了“面向仓库生成可读 Wiki”这件事有明确价值，但它在代码问答、审稿闭环、Provider 配置、Web 阅读体验和 CLI 使用体感上仍然存在缺口。

### 2.2 本轮设计来源
- 逆向 zread 的 prompt、tool、agent loop、Web 能力
- 借鉴 claude-code 的单主循环与 sub-agent 委派
- 借鉴 codex / opencode / oh-my-openagent 的工具命名、模型降级和执行体验
- 借鉴 deepwiki-open 的技术书式阅读思路

### 2.3 产品结论
RepoRead 应被定义为：
- 本地仓库阅读工作台
- 严格串行生成技术书式 Wiki 的系统
- 通过实时本地检索回答代码问题的系统
- 把独立审稿视为标准流程的系统

## 3. 产品定位
### 3.1 产品定义
RepoRead 是一个本地优先的代码阅读与技术书写工作台。它围绕同一套主控 Agent，在 `catalog`、`page`、`ask`、`research` 四种 mode 下工作，把仓库理解、页面生成、追问和研究统一到一条连续的阅读链路中。

### 3.2 产品边界
- 做：本地扫描、目录规划、严格串行页面生成、独立技术审稿、页面感知问答、版本浏览、Web/CLI 双端阅读
- 不做：通用 RAG 平台、通用 Agent Swarm 控制台、用户级 prompt 编排台、自动改代码执行器

### 3.3 核心价值
- 更像人类工程师的本地检索体感
- 更像书稿生产的章节连续性
- 更像真实出版流程的独立审稿机制
- 更低配置负担的 Provider 使用体验

## 4. 目标用户
- 需要快速读懂陌生仓库的工程师
- 需要交付内部技术 Wiki 或源码导读的团队
- 需要围绕现有页面继续提问、追溯证据、做深入研究的高级用户

## 5. 产品目标与非目标
### 5.1 产品目标
- 生成高质量、可持续阅读的技术书式 Wiki
- 提供比 zread 更强的代码问答能力
- 提供受控、可恢复的研究模式
- 提供清晰、稳定的 CLI 与 Web 体验
- 建立角色级 Provider / Model 路由能力，但不向用户暴露复杂调优面板

### 5.2 非目标
- 不做向量检索系统
- 不做 SQLite / FTS 式索引系统
- 不做章节级并行写作
- 不做对用户开放的 prompt 覆盖系统

## 6. 目标形态与实施原则
### 6.1 目标形态
V1 就按最终目标形态设计，不以“先做一个弱化版 Agent 平台”为前提。

### 6.2 实施原则
- 页面生成严格串行
- 并行仅用于单页内部取证
- 审稿必须独立会话
- 用户配置尽量少
- 系统内部负责模型适配、降级与 prompt 调优
```

- [ ] **Step 3: 运行结构校验，确认新定位已落地**

Run: `rg -n '^## 3\\. 产品定位|^## 5\\. 产品目标与非目标|严格串行|轻量清单|实时本地检索' docs/prd.md`
Expected: 命中上述章节标题和关键词。

- [ ] **Step 4: 运行反向校验，确认 PRD 顶层章节不再保留旧路线**

Run: `rg -n 'SQLite|embedding|向量检索|RAG 平台|Agent Swarm' docs/prd.md`
Expected: 无输出，或仅在“非目标”一节中出现否定式表述。

- [ ] **Step 5: Commit**

```bash
git add docs/prd.md
git commit -m "docs: rewrite prd positioning and goals"
```

### Task 2: 扩展 PRD 的功能、交互、质量与验收

**Files:**
- Modify: `docs/prd.md`
- Reference: `docs/zread_analysis/web-capabilities.md`
- Reference: `docs/zread_analysis/tool-agent-loop.md`
- Test: `docs/prd.md`

- [ ] **Step 1: 扩展用户旅程与信息架构，明确 Web/CLI 不是附属品**

将 `docs/prd.md` 的“关键用户旅程”和“信息架构”部分调整为以下要点：

```md
## 7. 关键用户旅程
### 7.1 首次使用：初始化与 Provider 配置
用户通过 CLI 完成项目初始化与 Provider 检测，系统只暴露最少必要配置，并明确 `main.author`、`fork.worker`、`fresh.reviewer` 三个角色的模型绑定结果。

### 7.2 首次生成：目录、页面、审稿、发布
生成流程遵循：
`catalog -> page(串行) -> fresh reviewer -> validator -> publish`
页面之间不并行；单页内部允许多路检索。

### 7.3 浏览与追问：边读边问
用户从 Web 进入项目书架、版本列表、左侧目录树、正文阅读区、引用抽屉和 Chat Dock，在当前页面上下文中继续提问。

### 7.4 深度研究：复杂问题追根溯源
研究模式以主控 Agent 为核心，可委派新的独立研究会话，但默认仍以本地检索和页面证据为主。

## 8. 信息架构
### 8.1 CLI 命令结构
- `reporead init`
- `reporead providers`
- `reporead generate`
- `reporead jobs`
- `reporead browse`
- `reporead ask`
- `reporead research`
- `reporead doctor`
- `reporead versions`

### 8.2 Web 路由结构
- `/projects`
- `/projects/:projectId`
- `/projects/:projectId/versions/:versionId`
- `/projects/:projectId/versions/:versionId/pages/:slug`
- `/projects/:projectId/versions/:versionId/search`
- `/projects/:projectId/jobs/:jobId`
```

- [ ] **Step 2: 重写详细功能需求，强调轻量清单、实时检索和独立审稿**

将“详细功能需求”改成以下要求：

```md
## 9. 详细功能需求
### 9.1 Provider 与模型配置
- 只向用户暴露角色级模型配置：`main.author`、`fork.worker`、`fresh.reviewer`
- 每个角色只暴露 `model` 与 `fallback_models`
- 系统内部维护模型族 prompt profile，不提供用户级覆盖

### 9.2 仓库理解与清单生成
- 生成最轻量清单：`wiki.json`、`pages/*.md`、`pages/*.meta.json`、`version.json`、`current.json`、`job-state.json`
- 不构建向量库、SQLite 索引或重型符号数据库

### 9.3 页面生成
- 目录完成后严格串行写页
- 页内允许并行取证、并行局部总结、并行对比
- 页面草稿必须经过 `fresh reviewer` 和确定性校验器

### 9.4 代码问答
- 先读当前页和引用，再做 `grep/find/read/git` 检索
- 回答必须可追溯到文件、页面或 commit
- 问答不依赖离线语义召回

### 9.5 深度研究
- 研究模式允许更长链路的检索与汇总
- 研究输出必须区分“事实”“推断”“待确认”

### 9.6 Web / CLI 体验
- CLI 负责初始化、生成、任务、诊断和快速问答
- Web 负责书架、目录树、正文阅读、引用展开、页面内追问和版本切换
```

- [ ] **Step 3: 替换非功能需求中的时间承诺，改成质量与可恢复性原则**

将“非功能需求与质量优先指标”改成以下结构：

```md
## 12. 非功能需求与质量原则
### 12.1 质量优先
系统优先保证章节连续性、证据完整性、审稿独立性和可恢复性，而不是追求固定分钟数内完成。

### 12.2 时长原则与可恢复性
- 不承诺固定生成时长
- 长任务必须可中断、可恢复、可重试
- 用户应能看到当前页、当前阶段、最近一次审稿状态和失败原因

### 12.3 质量指标
- 页面必须有明确证据来源
- 页面必须通过结构与链接校验
- 代码问答必须给出可追溯引用

### 12.4 安全与可靠性
- 默认只读
- 不上传源码
- 错误可见、状态可恢复、版本可回溯
```

- [ ] **Step 4: 补全界面设计、内容质量标准和验收清单**

在 `docs/prd.md` 中写入以下验收口径：

```md
## 10. 界面与交互要求
- Web 体感应接近“技术书阅读器”，不是通用 Agent 控制台
- 页面必须包含目录树、正文、引用抽屉、页面级 Chat Dock
- CLI 输出必须持续显示当前 mode、当前页、最近一次校验与审稿结果

## 11. 内容质量标准
- Catalog 必须体现阅读顺序和章节依赖
- 页面必须覆盖标题承诺，不得越界
- 审稿结论必须包含 blockers、factual_risks、missing_evidence、scope_violations

## 13. 验收标准与发布门槛
- 发布前必须通过审稿或完成修订
- 发布前必须通过结构校验、引用校验、链接校验
- 必须支持 `init -> generate -> interrupt -> resume -> browse -> ask` 完整链路
```

- [ ] **Step 5: 运行 PRD 完整校验并提交**

Run: `rg -n '质量优先|严格串行|轻量清单|实时本地检索|fresh reviewer|fork worker|角色级模型配置' docs/prd.md`
Expected: 全部命中。

Run: `git diff --check -- docs/prd.md`
Expected: 无输出。

```bash
git add docs/prd.md
git commit -m "docs: expand prd flows quality and acceptance"
```

### Task 3: 重写 Design 的核心工程架构、落盘协议与检索模型

**Files:**
- Modify: `docs/design.md`
- Read: `docs/superpowers/specs/2026-04-07-reporead-agent-redesign-design.md`
- Reference: `docs/zread_analysis/tool-agent-loop.md`
- Test: `docs/design.md`

- [ ] **Step 1: 运行旧设计扫描，定位需要移除的重型索引表述**

Run: `rg -n 'SQLite|索引库|FTS|embedding|向量|RAG|Worker Pool' docs/design.md`
Expected: 命中旧设计中的重型实现表述。

- [ ] **Step 2: 重写总体系统形态与关键决策，明确“轻量清单 + 实时本地检索”**

把 `docs/design.md` 的“总体系统形态”“技术选型与关键决策”改成以下内容：

```md
## 3. 总体系统形态
RepoRead 由三部分组成：
- `packages/core`：主控 Agent runtime、委派控制、确定性校验器、落盘与恢复
- `packages/cli`：初始化、Provider 配置、生成控制、任务观察、快速问答
- `packages/web`：项目书架、版本浏览、目录树、正文阅读、引用抽屉、页面级 Chat Dock

### 3.1 运行模式
- `catalog`
- `page`
- `ask`
- `research`

### 3.2 核心设计结论
- 单主循环
- 页面严格串行
- 并行仅用于单页内部检索
- 审稿为独立新会话
- 校验器确定性独立运行

## 5. 技术选型与关键决策
### 5.1 基础技术
- Markdown + JSON 作为主要落盘格式
- 本地文件系统作为唯一持久化介质
- `rg` / `find` / `git` / 窗口化读取作为主要检索能力

### 5.2 明确不采用的方案
- 不使用向量库
- 不使用 SQLite / FTS
- 不使用预构建重型索引服务
```

- [ ] **Step 3: 重写存储与落盘设计，只保留最轻清单**

将“存储与落盘设计”改成下面的目录树和文件职责：

````md
## 7. 存储与落盘设计
### 7.1 目录结构
```text
.reporead/
  projects/
    <project_slug>/
      project.json
      current.json
      jobs/
        <job_id>/
          job-state.json
          events.ndjson
          review/
            <page_slug>.review.json
      versions/
        <version_id>/
          version.json
          wiki.json
          pages/
            <slug>.md
            <slug>.meta.json
          citations/
            <slug>.citations.json
```

### 7.2 文件语义
- `wiki.json`：章节顺序、slug、父子关系、阅读顺序
- `pages/*.md`：最终页面正文
- `pages/*.meta.json`：页面标题、章节位置、摘要、上游页、下游页、覆盖文件
- `job-state.json`：当前 mode、当前页、失败原因、恢复点
- `review/*.review.json`：独立审稿摘要
- `events.ndjson`：任务事件流

### 7.3 设计限制
- 清单只承担导航、恢复、版本和引用职责
- 清单不得演变成代码索引数据库
````

- [ ] **Step 4: 重写仓库理解、检索和生成任务设计，删除预构建索引思路**

将“仓库画像与索引构建”“生成任务设计”改成以下结构：

```md
## 8. 仓库理解与实时本地检索
### 8.1 轻量项目清单
主控仅生成仓库级摘要：语言、入口、关键目录、关键文件、可疑超大文件、已有文档入口。

### 8.2 实时本地检索顺序
1. 读当前页面与页面 meta
2. `grep` 当前问题相关关键词
3. `find` / `glob` 缩小文件范围
4. `read` 窗口化读取候选文件
5. `git` 查询历史或 blame
6. 必要时再调用受控 `bash`

### 8.3 检索并行
只允许在单页内部并发执行多个互不重叠的检索任务。

## 9. 生成任务设计
### 9.1 状态机
`queued -> cataloging -> page_drafting -> reviewing -> validating -> publishing -> completed`

### 9.2 串行页面流水线
`catalog -> page_01 -> review -> validate -> page_02 -> review -> validate -> ...`

### 9.3 中断恢复
恢复时以 `job-state.json` 为准，从最近未完成页面继续，不重跑已发布页面。
```

- [ ] **Step 5: 运行 Design 核心校验并提交**

Run: `rg -n '轻量清单|实时本地检索|严格串行|job-state.json|events.ndjson|fresh reviewer' docs/design.md`
Expected: 全部命中。

Run: `rg -n 'SQLite|FTS|向量|embedding|Worker Pool|索引库结构' docs/design.md`
Expected: 无输出，或仅出现在“明确不采用”一节中。

```bash
git add docs/design.md
git commit -m "docs: rewrite design storage retrieval and pipeline"
```

### Task 4: 扩展 Design 的 Provider、Web/CLI、接口、并行与测试细节

**Files:**
- Modify: `docs/design.md`
- Reference: `docs/zread_analysis/web-capabilities.md`
- Test: `docs/design.md`

- [ ] **Step 1: 重写 Provider 配置与模型路由，只保留角色级配置面**

将“配置系统设计”改成以下内容：

````md
## 6. 配置系统设计
### 6.1 用户可配项
```json
{
  "providers": {
    "openai": { "api_key_env": "OPENAI_API_KEY" },
    "anthropic": { "api_key_env": "ANTHROPIC_API_KEY" }
  },
  "roles": {
    "main.author": {
      "model": "claude-sonnet-4.5",
      "fallback_models": ["gpt-5.4", "gpt-5.4-mini"]
    },
    "fork.worker": {
      "model": "gpt-5.4-mini",
      "fallback_models": ["claude-sonnet-4.5"]
    },
    "fresh.reviewer": {
      "model": "o3",
      "fallback_models": ["gpt-5.4", "claude-sonnet-4.5"]
    }
  }
}
```

### 6.2 系统内建能力
- 系统按模型族维护 prompt profile
- 系统负责 fallback 顺序与能力探测
- 不提供用户级 prompt 覆盖
````

- [ ] **Step 2: 扩展 Web 与 CLI 详细设计，强调阅读器心智**

将“Web 端详细设计”“CLI 详细设计”改成以下要点：

```md
## 11. Web 端详细设计
- 项目书架页：展示项目卡片、最后生成时间、当前版本、最近 job
- 版本阅读页：左侧目录树，中间正文，右侧引用抽屉和 Chat Dock
- 页面内追问：默认继承当前页上下文，可展开引用来源
- Job 详情页：展示当前 mode、当前页、最近一次 review 结果、恢复入口

## 12. CLI 详细设计
- `reporead init`：初始化项目
- `reporead providers`：检查 provider 与角色模型映射
- `reporead generate`：启动或恢复生成
- `reporead jobs`：查看任务
- `reporead ask`：命令行问答
- `reporead doctor`：诊断配置、权限、模型能力
- `reporead versions`：列出和切换版本

CLI 输出必须始终可见：
- 当前 mode
- 当前页 slug
- 当前阶段状态
- 最近一次 review / validate 结果
```

- [ ] **Step 3: 写清接口、事件流、并行规则和恢复语义**

补充以下内容到 `docs/design.md`：

```md
## 13. API 与事件契约
- `POST /api/projects/:projectId/generate`
- `POST /api/projects/:projectId/jobs/:jobId/resume`
- `GET /api/projects/:projectId/jobs/:jobId/events`
- `POST /api/projects/:projectId/ask`
- `POST /api/projects/:projectId/research`

事件流至少包含：
- `job.started`
- `catalog.completed`
- `page.drafting`
- `page.reviewed`
- `page.validated`
- `job.interrupted`
- `job.resumed`
- `job.completed`

## 14. 校验、发布与恢复
- 结构校验、引用校验、链接校验必须独立运行
- 失败时保留草稿、审稿结果和恢复点

## 15. 安全、可靠性与性能
- 默认只读
- 不上传源码
- 允许长任务，但必须中断可恢复
- 并行只用于页内检索，不用于跨页写作

## 16. 测试与验收方案
- 单元：状态机、配置解析、清单读写、恢复点判断
- 集成：`catalog -> page -> review -> validate`
- Golden：页面草稿、审稿结果、引用清单
- E2E：`init -> generate -> interrupt -> resume -> browse -> ask`
```

- [ ] **Step 4: 运行 Design 全量校验并提交**

Run: `rg -n 'main.author|fork.worker|fresh.reviewer|prompt profile|只读|interrupt|resume|E2E' docs/design.md`
Expected: 全部命中。

Run: `git diff --check -- docs/design.md`
Expected: 无输出。

```bash
git add docs/design.md
git commit -m "docs: expand design provider web cli and validation"
```

### Task 5: 重写 Agent Architecture 的拓扑、工具与运行协议

**Files:**
- Modify: `docs/agent-architecture.md`
- Read: `docs/superpowers/specs/2026-04-07-reporead-agent-redesign-design.md`
- Reference: `docs/zread_analysis/tool-agent-loop.md`
- Test: `docs/agent-architecture.md`

- [ ] **Step 1: 基线扫描，确认旧文档仍使用“多命名 Agent”结构**

Run: `rg -n 'CatalogAgent|PageWriterAgent|ChatAgent|ResearchSynthesizerAgent|Repair' docs/agent-architecture.md`
Expected: 命中旧拓扑表述。

- [ ] **Step 2: 重写文档前半部分，收敛为单主循环 + 两种委派**

将 `docs/agent-architecture.md` 的前半部分改成如下结构：

```md
# RepoRead 核心 Agent 架构设计文档

## 2. 设计来源与核心结论
- 借鉴 claude-code 的单主循环和 sub-agent 委派
- 借鉴 codex / opencode / oh-my-openagent 的工具与模型降级策略
- 借鉴 zread 的页面产出形态，但不沿用其能力边界

核心结论：
- 只有一个主控 Agent 实现
- 主控在 `catalog`、`page`、`ask`、`research` 四种 mode 下工作
- 只保留两种委派原语：`fork worker`、`fresh reviewer`
- 确定性校验器独立于 Agent

## 3. Agent 拓扑
- `main.author`
- `fork.worker`
- `fresh.reviewer`
- `validator`

## 4. 运行模式
### 4.1 `catalog`
生成目录、阅读顺序和页面计划

### 4.2 `page`
串行写作当前页，并在页内做必要并行取证

### 4.3 `ask`
围绕当前页和源码做本地检索式问答

### 4.4 `research`
处理更长链路的追根溯源问题
```

- [ ] **Step 3: 重写工具清单与并行规则，尽量复用成熟 Agent 的命名心智**

将“Tool 注册表”改成以下内容：

```md
## 6. Tool 注册表
### 6.1 核心工具
- `Read`
- `Grep`
- `Find`
- `Git`
- `Bash`
- `Agent`
- `Task`
- `SendMessage`
- `PageRead`
- `CitationOpen`

### 6.2 默认检索顺序
1. `PageRead`
2. `Grep`
3. `Find`
4. `Read`
5. `Git`
6. 受控 `Bash`

### 6.3 并行规则
- 允许：单页内部的多路检索、局部摘要、互不重叠文件检查
- 禁止：跨页并行写作、同页双写者、主控与子 agent 重复探索同一问题

### 6.4 委派规则
- `fork worker`：继承父上下文，只接收窄 directive，不得递归委派
- `fresh reviewer`：全新会话，收到完整 briefing，可重新检索，只产出 review 结论
```

- [ ] **Step 4: 重写上下文、模型、loop 和审稿协议**

将中后半部分改成以下内容：

```md
## 7. Model Router 与 Provider 策略
- 用户仅配置 `main.author`、`fork.worker`、`fresh.reviewer`
- 每个角色仅有 `model` 与 `fallback_models`
- 系统按模型族维护 prompt tuning profile
- prompt tuning 不向用户开放

## 8. 上下文管理
- 主控持有全书摘要、当前页计划、已发布页面摘要、当前证据账本
- `fork worker` 继承父上下文，但只能返回局部结构化结果
- `fresh reviewer` 不继承主控上下文，必须收到完整审稿 briefing

## 9. Catalog Loop
- 输入：项目摘要、入口文件、关键目录、已有文档
- 输出：严格阅读顺序的 `wiki.json`

## 10. Page Loop
- 顺序：`plan current page -> retrieve -> draft -> fresh review -> validate -> publish`
- 并行仅发生在 `retrieve`

## 11. Ask Loop
- 先读当前页与引用，再做本地检索
- 回答必须回链到文件、页面或 commit

## 12. Research Loop
- 在 `ask` 的基础上允许更长检索链路
- 输出必须标注事实、推断、待确认项

## 13. Reviewer 协议
审稿输入：
- 页面标题
- 章节位置
- 全书摘要
- 当前草稿
- 引用清单
- 覆盖文件
- 明确审稿问题

审稿输出：
- `verdict`
- `blockers`
- `factual_risks`
- `missing_evidence`
- `scope_violations`
- `suggested_revisions`
```

- [ ] **Step 5: 运行 Agent 架构校验并提交**

Run: `rg -n '单主循环|fork worker|fresh reviewer|prompt tuning profile|PageRead|CitationOpen|审稿输出' docs/agent-architecture.md`
Expected: 全部命中。

Run: `rg -n 'CatalogAgent|PageWriterAgent|ChatAgent|ResearchSynthesizerAgent|SQLite|向量' docs/agent-architecture.md`
Expected: 无输出，或仅在“设计来源/明确不做”中出现否定式表述。

```bash
git add docs/agent-architecture.md
git commit -m "docs: rewrite agent architecture around single main loop"
```

### Task 6: 补足 Agent 文档的 prompt、失败处理，并做三文档一致性校验

**Files:**
- Modify: `docs/agent-architecture.md`
- Modify: `docs/prd.md`
- Modify: `docs/design.md`
- Test: `docs/prd.md`
- Test: `docs/design.md`
- Test: `docs/agent-architecture.md`

- [ ] **Step 1: 为 Agent 文档补全 prompt 模板与失败处理章节**

在 `docs/agent-architecture.md` 中补入以下内容：

```md
## 14. Prompt 模板
### 14.1 `main.author`
职责：作为唯一作者推进目录、页面、问答和研究主线；优先使用已有页面和本地检索结果；避免无证据扩写。

### 14.2 `fork.worker`
职责：在限定范围内做证据搜索、局部总结、差异对比；禁止重写页面；禁止递归委派。

### 14.3 `fresh.reviewer`
职责：以全新上下文审稿；主动质疑证据不足、边界越界、过度自信；必要时重新检索。

## 15. 失败处理与降级
- 主模型失败时按角色 fallback 链降级
- 工具失败时保留失败上下文，允许改写 query 后重试
- 审稿失败不允许跳过，必须重试或终止发布
- 页面失败时保留草稿、review 结果与恢复点
```

- [ ] **Step 2: 对三份文档做跨文档术语对齐**

确保三份文档统一使用以下术语，不要出现并列别名：

```md
- `main.author`
- `fork.worker`
- `fresh.reviewer`
- `轻量清单`
- `实时本地检索`
- `严格串行`
- `系统内建 prompt 调优`
```

必要时同步修改 `docs/prd.md`、`docs/design.md`、`docs/agent-architecture.md` 中的表述差异。

- [ ] **Step 3: 运行全量一致性校验**

Run: `rg -n 'main.author|fork.worker|fresh.reviewer|轻量清单|实时本地检索|严格串行|prompt 调优' docs/prd.md docs/design.md docs/agent-architecture.md`
Expected: 三份文档都能命中核心术语。

Run: `rg -n 'SQLite|FTS|embedding|向量检索|RAG 平台|Agent Swarm' docs/prd.md docs/design.md docs/agent-architecture.md`
Expected: 无输出，或仅在“非目标/明确不做/明确不采用”中出现否定式表述。

Run: `rg -n 'TODO|TBD|implement later|fill in details|Similar to Task' docs/prd.md docs/design.md docs/agent-architecture.md`
Expected: 无输出。

Run: `git diff --check -- docs/prd.md docs/design.md docs/agent-architecture.md`
Expected: 无输出。

- [ ] **Step 4: 产出最终提交**

```bash
git add docs/prd.md docs/design.md docs/agent-architecture.md
git commit -m "docs: align prd design and agent architecture"
```
