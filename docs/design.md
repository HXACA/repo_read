# RepoRead 工程整体设计文档

> 版本：v3.1
> 更新时间：2026-04-08
> 文档定位：定义可直接开发的工程详细设计，约束系统形态、落盘协议、检索模型与任务流水线
> 关联文档：
> - [产品需求文档（PRD）](./prd.md)
> - [核心 Agent 架构设计文档](./agent-architecture.md)
> - [Zread Tool 与 Agent Loop](./zread_analysis/tool-agent-loop.md)
> - [Zread 的 Web 能力](./zread_analysis/web-capabilities.md)

---

## 1. 文档范围

本文件回答四个问题：

1. RepoRead 的总体系统形态、模块边界和运行 mode 是什么。
2. 轻量清单、版本目录、任务状态和引用文件如何落盘。
3. 仓库理解、实时本地检索、页面生成与恢复如何工作。
4. 在不引入重型基础设施的前提下，Web 与 CLI 如何共享同一套核心运行时。

本文默认 V1 仍然是只读代码理解系统，不包含代码写回、自动修复 PR 和多用户协作。

---

## 2. 设计输入与约束

### 2.1 设计输入

| 来源 | 对工程设计的直接影响 |
| --- | --- |
| Zread 逆向结果 | 保留 `Catalog -> Page` 两阶段生成、版本化 Wiki、本地浏览、草稿恢复 |
| DeepWiki-Open | 引入代码问答、Deep Research、面向会话的证据组织方式 |
| Claude Code / Codex | 工具权限边界、上下文压缩、plan/work 分层、统一 runtime |
| OpenCode | CLI 优先、provider-agnostic、本地运行体验 |
| oh-my-openagent | hooks、模型路由、继续执行策略、检索增强 |

### 2.2 工程约束

1. 本地优先。核心数据必须能在单机文件系统中完整运行，并落盘为 Markdown + JSON。
2. V1 不采用数据库全文检索层、语义检索底座或预构建重型索引服务；仓库理解依赖轻量清单和实时本地检索。
3. Web 与 CLI 共享同一套 `packages/core` runtime，不允许分别实现生成、问答和研究逻辑。
4. 系统运行 mode 统一为 `catalog` / `page` / `ask` / `research`，由单主循环推进状态。
5. 默认策略是质量优先：页面严格串行、审稿独立、校验确定性执行，不为了吞吐牺牲可恢复性。

### 2.3 非目标

1. V1 不做代码写回仓库。
2. V1 不做多用户权限系统。
3. V1 不做云端任务调度器。
4. V1 不做仓库全量镜像数据库。

---

## 3. 总体系统形态

RepoRead 是一个三包 monorepo，工程边界固定为 `packages/core`、`packages/cli`、`packages/web`。其中 `packages/core` 提供唯一运行时，CLI 和 Web 只是两个交互壳层。

```text
packages/cli
  - init / generate / ask / research / browse / doctor
          │
          ├──── consume core services and events
          │
packages/web
  - providers / jobs / wiki / search / research
          │
          ├──── consume core services and events
          │
packages/core
  - config / project / catalog / generation / retrieval / review
  - validation / wiki / events / tools / providers / storage
          │
          ▼
Local Infrastructure
  - File System (`.reporead`)
  - Markdown + JSON
  - `rg` / `find` / `git`
  - windowed file read
  - readonly controlled shell
  - secret store
  - LLM providers
```

### 3.1 运行 mode

`catalog` / `page` / `ask` / `research` 是顶层运行 mode；`cataloging` / `page_drafting` / `reviewing` / `validating` / `publishing` 仅是 generate 任务内部 stage，不是新的 mode。

| mode | 入口 | 核心目标 | 主要产物 |
| --- | --- | --- | --- |
| `catalog` | `generate` 内部阶段 | 建立仓库画像、章节树、页面顺序 | `wiki.json` 草案、首个页面指针 |
| `page` | `generate` 内部阶段 | 生成单页、审稿、校验、写入版本草稿 | `pages/*.md`、`pages/*.meta.json`、`review/*.review.json` |
| `ask` | CLI `ask` / Web Chat Dock | 基于当前页面和实时本地检索回答问题 | 流式回答、引用链、会话摘要 |
| `research` | CLI `research` / Web Research | 多步证据归并、形成结论 | 研究计划、研究过程、结论与引用 |

### 3.2 核心设计结论

1. 单主循环推进全局状态，成功路径固定为 `catalog -> page -> review -> validate -> publish`。
2. 页面生成必须严格串行，顺序固定为 `catalog -> page_01 -> review -> validate -> page_02 -> ...`。
3. 并行只允许发生在单页内部、互不重叠的实时本地检索，不允许跨页面并发写作。
4. `fresh reviewer` 必须是独立新会话，不复用起草页的上下文。
5. 校验器是确定性独立运行单元，不嵌入审稿 Prompt，不依赖模型自由发挥。
6. 轻量清单只负责导航、恢复、版本和引用，不承担代码索引数据库职责。
7. 事件流是统一基础设施，CLI 和 Web 都只消费同一组服务输出和落盘状态。

---

## 4. Monorepo 结构

```text
repo-read/
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── agents/
│   │       ├── ask/
│   │       ├── catalog/
│   │       ├── config/
│   │       ├── events/
│   │       ├── generation/
│   │       ├── policy/
│   │       ├── project/
│   │       ├── providers/
│   │       ├── research/
│   │       ├── retrieval/
│   │       ├── review/
│   │       ├── secrets/
│   │       ├── storage/
│   │       ├── tools/
│   │       ├── types/
│   │       ├── validation/
│   │       └── wiki/
│   ├── cli/
│   │   └── src/
│   │       ├── commands/
│   │       ├── components/
│   │       ├── presenters/
│   │       └── utils/
│   └── web/
│       └── src/
│           ├── app/
│           ├── components/
│           ├── features/
│           ├── hooks/
│           ├── lib/
│           └── server/
├── docs/
└── pnpm-workspace.yaml
```

### 4.1 `packages/core` 模块职责

| 模块 | 职责 | 核心输出 |
| --- | --- | --- |
| `config/` | 配置 schema、覆盖合并、环境变量解析 | `ResolvedConfig` |
| `secrets/` | 凭证读写、掩码、引用解析 | `SecretRef` |
| `providers/` | Provider 抽象、能力探测、模型路由、回退链 | `ModelRoutePlan` |
| `project/` | 仓库扫描、ignore 规则、语言/框架识别、入口发现、轻量仓库画像 | `RepoProfile` |
| `catalog/` | 目录规划、页面顺序、章节树、`wiki.json` 草案 | `CatalogPlan` |
| `generation/` | 串行页面流水线、恢复、发布 | `GenerationJob` |
| `retrieval/` | 当前页优先的实时本地检索瀑布 | `EvidencePack` |
| `ask/` | 问答会话、上下文压缩、引用编排 | `AskSession` |
| `research/` | 研究计划、子问题拆解、证据汇总 | `ResearchRun` |
| `review/` | `fresh reviewer` 审稿、问题归类、修订建议 | `ReviewResult` |
| `validation/` | JSON/Markdown/Mermaid/引用/链接校验 | `ValidationReport` |
| `wiki/` | 页面读取、版本切换、搜索、比较 | `PageViewModel` |
| `storage/` | `.reporead` 目录结构、清单与任务状态落盘 | `StorageAdapter` |
| `events/` | 统一事件流、SSE 适配、CLI 订阅 | `AppEvent` |
| `tools/` | Agent 只读工具与执行防护 | `ToolResult` |
| `policy/` | 路径防护、并发限制、工具预算 | `PolicyDecision` |

### 4.2 `packages/cli` 模块职责

| 模块 | 职责 |
| --- | --- |
| `commands/init.ts` | 首次向导，完成项目绑定与 Provider 配置 |
| `commands/config.ts` | 修改配置、查看角色映射、验证连通性 |
| `commands/providers.ts` | 展示 Provider 健康状态和回退链 |
| `commands/generate.ts` | 发起任务、展示串行阶段和当前页面 |
| `commands/jobs.ts` | 查看历史任务、恢复最近未完成页面 |
| `commands/browse.ts` | 启动本地 Web 服务并打印地址 |
| `commands/ask.ts` | 终端问答、显示引用摘要 |
| `commands/research.ts` | 深度研究终端模式 |
| `commands/doctor.ts` | 环境和状态诊断 |
| `components/` | 阶段时间线、页面进度表、引用摘要、错误面板 |

### 4.3 `packages/web` 模块职责

| 模块 | 职责 |
| --- | --- |
| `app/` | 页面路由与 API Route Handlers |
| `features/providers/` | Provider 配置中心 |
| `features/generate/` | 生成工作台与任务追踪 |
| `features/projects/` | 项目首页、版本列表、版本比较 |
| `features/wiki/` | Wiki 三栏阅读器、源码抽屉、版本切换 |
| `features/search/` | 页面/文件/引用搜索 |
| `features/chat/` | Chat Dock、会话管理、回答渲染 |
| `features/research/` | 研究计划、研究进展、结论视图 |
| `server/` | SSE 适配、流式响应、服务端 view model 组装 |

---

## 5. 技术选型与关键决策

### 5.1 基础技术

| 领域 | 选择 | 原因 |
| --- | --- | --- |
| 语言 | TypeScript | 共享类型、CLI/Web/Core 一致 |
| Web UI | Next.js App Router + React | 页面路由、SSR 首屏、组件生态成熟 |
| CLI UI | Ink 或等价 TUI 组件库 | 阶段、页面和引用输出可视化 |
| 落盘格式 | Markdown + JSON | 可审阅、可 diff、可恢复、便于版本化 |
| 本地持久化 | 文件系统 `.reporead` | 单机完整运行，目录结构直观 |
| 实时检索 | `rg` / `find` / `git` / 窗口化读取 | 不预建重型索引，按需取证 |
| 受控命令 | 白名单只读 bash | 补足 grep/find/git 不足时的受控兜底 |
| Markdown 渲染 | `remark`/`rehype` 管线 | 可插入 Mermaid、引用芯片、slug 路由 |
| 图表 | Mermaid | 与 PRD 一致，适合文档生成 |
| 校验 | Zod + 确定性 validator | 结构化输出与配置校验统一 |

明确不采用：

1. 向量库。
2. `SQLite / FTS`。
3. 预构建全文库或代码索引服务。
4. 长驻后台索引进程。
5. 需要额外运维的数据库化检索层。

### 5.2 Web 实时通道

V1 统一使用 `SSE`，不以 WebSocket 作为主实时通道。

理由：

1. 本地单机模式下，SSE 足以承载任务事件和聊天流式输出。
2. SSE 更容易恢复和复用 HTTP 鉴权语义。
3. 生成、问答和研究都可统一为“服务器持续推送事件”。

### 5.3 密钥存储

采用两层结构：

1. 配置文件只保存 `secretRef`，不保存明文。
2. 明文密钥存放在 `SecretStore`。

`SecretStore` 实现顺序：

1. 优先系统 Keychain。
2. Keychain 不可用时，允许用户选择仅环境变量模式。

V1 不在项目目录中持久化明文密钥。

### 5.4 只读边界

所有 Agent 工具都属于只读工具。

允许：

1. 读目录。
2. 读文件。
3. 用 `rg` 做全文检索。
4. 用 `find` / glob 找文件。
5. 做窗口化读取。
6. 读 git 元信息。
7. 执行白名单只读 shell。

不允许：

1. 修改仓库文件。
2. 写 git 对象。
3. 访问仓库外路径。
4. 构建常驻索引或缓存服务。
5. 执行非白名单 shell。

---

## 6. 配置系统设计

### 6.1 配置来源与优先级

优先级从高到低：

1. CLI flag / Web 表单即时输入
2. 项目配置
3. 全局配置
4. 环境变量默认值

### 6.2 `ResolvedConfig`

```ts
type ResolvedConfig = {
  projectSlug: string
  repoRoot: string
  preset: 'quality' | 'balanced' | 'budget' | 'local-only'
  roles: {
    planner: ModelRef
    writer: ModelRef
    reviewer: ModelRef
    chat: ModelRef
    research: ModelRef
  }
  retrieval: {
    maxParallelReadsPerPage: number
    maxReadWindowLines: number
    allowControlledBash: boolean
  }
}
```

### 6.3 Provider 配置向导

Provider 向导负责：

1. 发现可用 Provider。
2. 校验模型能力。
3. 把模型绑定到角色，而不是绑到单命令。
4. 输出当前预设下的最终运行摘要。

### 6.4 Provider 能力探测

`ProviderCenterService` 对每个模型记录这些能力：

```ts
type ModelCapability = {
  supportsStreaming: boolean
  supportsToolCalls: boolean
  supportsJsonSchema: boolean
  supportsReasoningContent: boolean
  maxContextWindow?: number
  isLocalModel: boolean
}
```

能力探测结果缓存到全局配置目录，避免每次启动重复探测。

### 6.5 预设定义

| 预设 | 路由策略 | 页内检索上限 | 典型用途 |
| --- | --- | --- | --- |
| `quality` | 规划/写作/审校分离，优先强模型 | 2 | 默认模式 |
| `balanced` | 规划强模型，写作中档模型 | 3 | 一般仓库 |
| `budget` | 尽量复用单模型，降低检索规模 | 2 | 成本敏感 |
| `local-only` | 本地模型 + 关闭外部检索 | 1 | 离线环境 |

---

## 7. 存储与落盘设计

### 7.1 目录结构

```text
.reporead/
├── current.json
└── projects/
    └── <project_slug>/
        ├── project.json
        ├── jobs/
        │   └── <job_id>/
        │       ├── job-state.json
        │       ├── events.ndjson
        │       ├── draft/
        │       │   └── <version_id>/
        │       │       ├── version.json
        │       │       ├── wiki.json
        │       │       ├── pages/
        │       │       │   ├── <page_slug>.md
        │       │       │   └── <page_slug>.meta.json
        │       │       └── citations/
        │       │           └── <page_slug>.citations.json
        │       └── review/
        │           ├── catalog.review.json
        │           └── <page_slug>.review.json
        └── versions/
            └── <version_id>/
                ├── version.json
                ├── wiki.json
                ├── pages/
                │   ├── <page_slug>.md
                │   └── <page_slug>.meta.json
                ├── citations/
                │   └── <page_slug>.citations.json
                └── research/
                    └── <session_id>.json
```

### 7.2 关键文件语义

| 文件 | 作用 |
| --- | --- |
| `current.json` | 当前默认项目、版本、最近页面与最近任务指针，供 CLI/Web 启动时恢复上下文 |
| `projects/<project_slug>/project.json` | 项目绑定信息、仓库根路径、分支、忽略规则、最近版本列表、轻量仓库画像摘要 |
| `projects/<project_slug>/jobs/<job_id>/job-state.json` | 任务状态机快照、当前阶段、当前页面、下一页指针、失败原因，是恢复的唯一准源 |
| `projects/<project_slug>/jobs/<job_id>/events.ndjson` | append-only 事件日志，既用于 SSE 回放，也用于故障审计 |
| `projects/<project_slug>/jobs/<job_id>/draft/<version_id>/...` | job 级草稿目录，`page_drafting` / `reviewing` / `validating` 全部写在这里；恢复时也从这里读取页面、meta 和 citations |
| `projects/<project_slug>/jobs/<job_id>/review/*.review.json` | `fresh reviewer` 和校验器对 catalog / page 的独立结果，记录问题、结论和修订建议 |
| `projects/<project_slug>/versions/<version_id>/version.json` | 版本级元信息，记录 commit、发布时间、页面顺序、发布摘要和整体状态 |
| `projects/<project_slug>/versions/<version_id>/wiki.json` | 目录树、页面顺序、章节摘要、页面间关系，是阅读导航的主清单 |
| `projects/<project_slug>/versions/<version_id>/pages/*.md` | 最终发布页面正文 |
| `projects/<project_slug>/versions/<version_id>/pages/*.meta.json` | 页面标题、摘要、顺序、覆盖文件、审稿摘要、校验状态、引用文件指针；不反向引用 job 级过程文件 |
| `projects/<project_slug>/versions/<version_id>/citations/*.citations.json` | 页面到源码/文档/Git 证据的精确映射，供引用芯片、源码抽屉和问答复用 |

### 7.3 页面元数据

```ts
type PageMeta = {
  slug: string
  title: string
  order: number
  sectionId: string
  coveredFiles: string[]
  relatedPages: string[]
  generatedAt: string
  commitHash: string
  citationFile: string
  summary: string
  reviewStatus: 'accepted' | 'accepted_with_notes'
  reviewSummary: string
  reviewDigest: string
  status: 'drafted' | 'reviewed' | 'validated' | 'published'
  validation: {
    structurePassed: boolean
    mermaidPassed: boolean
    citationsPassed: boolean
    linksPassed: boolean
  }
}
```

### 7.4 清单边界

轻量清单只承担四类职责：

1. 导航：`wiki.json`、`pages/*.meta.json`
2. 恢复：`current.json`、`job-state.json`、`events.ndjson`
3. 版本：`project.json`、`version.json`
4. 引用：`citations/*.citations.json`

禁止演变为：

1. 代码切块仓库。
2. 长文本倒排结构持久层。
3. 语义检索底座。
4. 替代源码本身的镜像数据库。

### 7.5 版本发布语义

1. 生成过程先写 `projects/<project_slug>/jobs/<job_id>/draft/<version_id>/...`，其中页面正文、page meta、citations 和草稿态 `version.json` / `wiki.json` 都在这里增量落盘。
2. 恢复时优先读取 `job-state.json`，并回到对应的 `draft/<version_id>/...` 继续处理最近未完成页面。
3. 只有通过 `publishing` 阶段后，才以原子方式把 `draft/<version_id>/...` 提升到 `versions/<version_id>/...`，然后更新 `current.json`。
4. 发布只接受完整版本；若任务中断或失败，草稿目录保留，默认指针不前移。

---

## 8. 仓库理解与检索

### 8.1 Repo Profiler 输出

```ts
type RepoProfile = {
  projectSlug: string
  repoRoot: string
  repoName: string
  branch: string
  commitHash: string
  languages: string[]
  frameworks: string[]
  packageManagers: string[]
  entryFiles: string[]
  importantDirs: string[]
  ignoredPaths: string[]
  sourceFileCount: number
  docFileCount: number
  treeSummary: string
  architectureHints: string[]
}
```

### 8.2 轻量项目清单与仓库画像

V1 只做轻量项目清单，不做重型索引构建。`catalog` 阶段的目标是回答“仓库是什么、页面该怎么排、先看哪里”，而不是把代码重新存一遍。

长期保存的信息只包括：

1. 仓库绑定信息、分支和 commit。
2. 语言、框架、包管理器、入口文件、关键目录。
3. 页面树、页面顺序、每页覆盖文件与引用指针。
4. 恢复任务所需的当前阶段、当前页、最近错误和事件流。

以下信息只在运行时临时计算，不长期落盘为索引：

1. grep 命中列表。
2. 文件候选集。
3. 窗口化读取片段。
4. Git 历史证据。
5. 受控 bash 的补充结果。

### 8.3 实时本地检索顺序

统一的实时本地检索瀑布如下：

```text
当前页与 meta
  -> grep
  -> find / glob
  -> read
  -> git
  -> 受控 bash
```

执行规则：

1. 先读当前页正文、`pages/*.meta.json` 和 `citations/*.citations.json`，尽量复用已有理解。
2. `grep` 负责快速确认关键词、符号名、配置项、错误串在仓库中的落点。
3. `find / glob` 负责缩小候选文件集合，避免无界全文扫描。
4. `read` 只做窗口化读取，围绕命中的文件和行段补足上下文。
5. `git` 只在需要解释演进、版本差异、责任边界时进入。
6. 受控 bash 只能做只读补证，且必须在前序步骤不足时才允许触发。

### 8.4 并行边界

1. 并行只允许发生在单页内部互不重叠的检索任务，例如同时读取两个不同目录下的候选文件。
2. 同一文件的重叠窗口读取必须串行，避免证据交叉污染。
3. `catalog` 和 `page` 之间不并行，页面之间也不并行。
4. 任何会修改主状态机位置的动作都必须串行落盘后再发事件。

---

## 9. 生成任务设计

### 9.1 任务状态机

```text
queued
  -> cataloging
  -> page_drafting
  -> reviewing
  -> validating
  -> publishing
  -> completed
```

异常终态单独记录为 `failed` 或 `cancelled`，但不属于主成功路径。

### 9.2 `GenerationJob`

```ts
type GenerationJob = {
  id: string
  projectSlug: string
  repoRoot: string
  versionId: string
  status:
    | 'queued'
    | 'cataloging'
    | 'page_drafting'
    | 'reviewing'
    | 'validating'
    | 'publishing'
    | 'completed'
    | 'failed'
    | 'cancelled'
  createdAt: string
  startedAt?: string
  finishedAt?: string
  configSnapshot: ResolvedConfig
  currentPageSlug?: string
  nextPageOrder?: number
  summary: {
    totalPages?: number
    succeededPages?: number
    failedPages?: number
  }
}
```

### 9.3 阶段行为

| 阶段 | 输入 | 输出 | 失败策略 |
| --- | --- | --- | --- |
| `cataloging` | 项目路径、配置、仓库画像 | 页面顺序、`wiki.json` 草案、首个页面指针 | 最多 2 次重试，失败则任务终止 |
| `page_drafting` | 当前页面计划、仓库、已有页面清单 | `draft/<version_id>/pages/*.md` 与 `draft/<version_id>/pages/*.meta.json` 初稿 | 失败留在当前页，不推进下一页 |
| `reviewing` | 当前页草稿 | `review/*.review.json`，并把审稿摘要回写到 `draft/<version_id>/pages/*.meta.json` | 必须由 `fresh reviewer` 独立运行，失败留在当前页 |
| `validating` | 审稿后的页面与引用 | 确定性 `ValidationReport`，并更新 `draft/<version_id>/...` 中对应文件 | 失败留在当前页，允许修复后重试 |
| `publishing` | 全部已验证页面、`draft/<version_id>/wiki.json`、`draft/<version_id>/version.json` | 原子提升到 `versions/<version_id>/...` 并更新 `current.json` | 任一步失败都回滚默认指针更新 |

### 9.4 严格串行页面流水线

主流水线固定为：

```text
catalog -> page_01 -> review -> validate -> page_02 -> review -> validate -> ... -> publish
```

执行要点：

1. 每次只允许一个页面处于 `page_drafting` / `reviewing` / `validating` 之一。
2. 页面完成后才会推进 `job-state.json.nextPageOrder`。
3. 新页面可以读取已完成的前序页面，但不能回写或并发修改前序页面。
4. 所有阶段切换先写 `job-state.json`，再追加 `events.ndjson`，最后通知 CLI/Web。

### 9.5 中断恢复

恢复逻辑：

1. 读取 `job-state.json`，它是恢复的唯一准源。
2. 若状态停在 `cataloging`，则从 catalog 重新生成页面顺序与 `draft/<version_id>/wiki.json` 草案。
3. 若状态停在 `page_drafting` / `reviewing` / `validating`，则从 `draft/<version_id>/...` 读取最近未完成页面继续。
4. `events.ndjson` 只用于时间线回放与诊断，不用于覆盖 `job-state.json`。

---

## 10. 问答与研究设计

### 10.1 问答路径选择

`AskService` 在收到用户问题后先执行路由判定：

1. `page-first`
   - 当前页面和相关页面足够回答
2. `page-plus-retrieval`
   - 需要补充实时本地检索证据
3. `research`
   - 问题跨多个模块、需要比较、追踪因果或版本差异

### 10.2 检索瀑布

问答与研究直接复用 8.3 的同一条实时本地检索瀑布，不再维护另一套检索顺序。

```text
当前页与 meta
  -> grep
  -> find / glob
  -> read
  -> git
  -> 受控 bash
```

原则：

1. 先用现成页面，避免重复全仓扫描。
2. 代码检索只做定向补证，不做预构建索引依赖。
3. 研究模式可以多轮检索，但仍遵守同一套本地瀑布。

### 10.3 会话存储

```ts
type AskSession = {
  id: string
  projectSlug: string
  versionId: string
  mode: 'ask' | 'research'
  currentPageSlug?: string
  turns: Array<{
    role: 'user' | 'assistant'
    content: string
    citations: CitationRecord[]
  }>
  compactSummary?: string
  recentEvidence: EvidenceRecord[]
  updatedAt: string
}
```

`AskSession` 在 V1 中是内存态会话，不进入版本目录，也不写入项目长期清单。页面关闭、进程退出或用户显式清空后即可丢弃；只有 `research` 的结论性产物才持久化到 `research/`。

### 10.4 深度研究

研究模式由 `ResearchService` 驱动：

1. 生成研究计划。
2. 拆分 2-5 个子问题。
3. 为每个子问题执行定向检索与证据归并。
4. 合成阶段性发现。
5. 在达到预算或证据充分时输出结论。

V1 研究结果落盘到版本目录的 `research/` 中，便于回看。

---

## 11. Web 端详细设计

### 11.1 路由

| 路由 | 作用 |
| --- | --- |
| `/` | 首页，项目列表、最近任务、最近研究 |
| `/settings/providers` | Provider 配置中心 |
| `/generate` | 发起新任务、查看阶段进度 |
| `/jobs/:jobId` | 单任务详情 |
| `/projects/:project` | 项目概览 |
| `/projects/:project/:version/:slug` | Wiki 页面 |
| `/projects/:project/:version/search` | 搜索页 |
| `/projects/:project/:version/compare` | 版本对比页 |
| `/projects/:project/:version/research` | 研究工作区 |

### 11.2 Provider 配置中心

组件拆分：

| 组件 | 职责 |
| --- | --- |
| `PresetSelector` | 选择 `quality/balanced/budget/local-only` |
| `ProviderCardList` | 展示已配置 Provider、状态与编辑入口 |
| `SecretEditorDialog` | 新增或更新密钥 |
| `RoleModelMatrix` | 按角色分配模型 |
| `CapabilityProbePanel` | 连通性与能力测试 |
| `FallbackChainEditor` | 为角色配置回退链 |
| `ConfigSummary` | 输出“当前配置将如何运行”摘要 |

### 11.3 生成工作台

组件拆分：

| 组件 | 职责 |
| --- | --- |
| `RepoTargetCard` | 当前仓库与版本备注 |
| `GenerationConfigPanel` | 语言、预设、排除规则 |
| `StageTimeline` | 阶段视图 |
| `PageQueueTable` | 串行页面进度视图 |
| `FailurePanel` | 失败原因与恢复入口 |
| `ToolActivityStream` | 当前工具摘要，不显示原始噪声日志 |
| `JobSummaryCard` | Token、页数、错误数、持续时间 |

交互规则：

1. 页面刷新后根据 `jobId` 恢复 SSE 订阅。
2. 完成后跳转到新版本或停留在详情页。
3. 任务失败或中断时展示“从最近未完成页面继续”入口。

### 11.4 Wiki 页面

采用三栏结构：

1. 左侧 `WikiSidebar`
   - `section/group/topic` 树
   - 搜索过滤
   - 版本切换
2. 中间 `WikiContent`
   - 页面头部
   - Markdown 正文
   - 相关页面
3. 右侧 `WikiUtilityRail`
   - TOC
   - Source Drawer
   - Chat Dock

关键组件：

| 组件 | 职责 |
| --- | --- |
| `WikiPageHeader` | 标题、摘要、版本、commit、生成时间 |
| `MarkdownPageRenderer` | Markdown、Mermaid、引用芯片 |
| `CitationChip` | 点击打开源码抽屉 |
| `SourceDrawer` | 文件路径、行号、代码片段、复制 |
| `RelatedPageList` | 推荐阅读 |
| `ChatDock` | 页面内问答和研究入口 |

### 11.5 搜索页

支持三种搜索标签：

1. 页面
2. 文件
3. 引用

默认按页面聚合展示，并允许切换到代码视角。

### 11.6 任务详情页

`/jobs/:jobId` 应包含：

1. 阶段时间线。
2. 页面任务表。
3. 错误摘要。
4. 从最近未完成页面恢复。
5. 链接到生成出的版本。

---

## 12. CLI 详细设计

### 12.1 命令矩阵

| 命令 | 行为 | 关键选项 |
| --- | --- | --- |
| `repo-read init` | 创建项目级配置并引导 Provider 配置 | `--preset` |
| `repo-read config` | 编辑或查看配置 | `--global`, `--project` |
| `repo-read providers` | 展示 Provider 状态 | `--test`, `--json` |
| `repo-read generate` | 发起任务 | `--resume`, `--clear`, `--note` |
| `repo-read jobs` | 查看任务 | `--latest`, `--watch` |
| `repo-read browse` | 启动本地 Web | `--port`, `--version` |
| `repo-read ask` | 终端问答 | `--page`, `--version`, `--clear` |
| `repo-read research` | 深度研究 | `--page`, `--version` |
| `repo-read doctor` | 环境检查 | `--fix-hints`, `--json` |
| `repo-read versions` | 版本列表 | `--project` |

### 12.2 输出设计

`generate` 终端输出固定为四块：

1. 任务摘要。
2. 阶段时间线。
3. 页面进度表。
4. 最新错误/提示。

`ask` 输出固定为三块：

1. 上下文徽标。
2. 流式答案。
3. 引用摘要。

### 12.3 CLI 与 Web 的关系

1. CLI 是快速入口和运维界面。
2. Web 是长时间阅读和研究界面。
3. CLI 命令不直接实现业务逻辑，只调用 `packages/core` 服务。

---

## 13. API 与事件契约

### 13.1 HTTP API

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/projects` | 项目列表 |
| `GET` | `/api/projects/:project` | 项目概览 |
| `GET` | `/api/projects/:project/versions/:version/wiki` | 导航树与版本信息 |
| `GET` | `/api/projects/:project/versions/:version/pages/:slug` | 页面正文与元信息 |
| `GET` | `/api/projects/:project/versions/:version/search` | 搜索 |
| `GET` | `/api/projects/:project/versions/:version/source` | 源码片段读取 |
| `POST` | `/api/config/providers/test` | 测试 Provider 与模型能力 |
| `GET` | `/api/config/providers` | 读取当前配置摘要 |
| `PUT` | `/api/config/providers` | 保存配置 |
| `POST` | `/api/jobs` | 发起新任务 |
| `GET` | `/api/jobs/:jobId` | 任务详情 |
| `POST` | `/api/jobs/:jobId/cancel` | 取消任务 |
| `POST` | `/api/jobs/:jobId/resume` | 从最近未完成页面继续 |
| `POST` | `/api/chat/stream` | 流式问答 |
| `POST` | `/api/research/stream` | 流式研究 |

### 13.2 SSE 事件

所有 SSE 事件遵循统一封装：

```ts
type AppEvent<T = unknown> = {
  id: string
  channel: 'job' | 'chat' | 'research'
  type: string
  at: string
  payload: T
}
```

关键事件类型：

| Channel | 事件 |
| --- | --- |
| `job` | `job.started`, `stage.changed`, `page.started`, `page.reviewed`, `page.validated`, `job.completed` |
| `chat` | `chat.started`, `chat.delta`, `chat.citation`, `chat.completed`, `chat.error` |
| `research` | `research.plan`, `research.progress`, `research.finding`, `research.completed` |

---

## 14. 校验、发布与恢复

### 14.1 页面校验

页面校验分四层：

1. 结构校验
2. 引用校验
3. Mermaid 校验
4. 链接校验

任何一层失败都不能直接发布该页。

### 14.2 发布门槛

发布时必须满足：

1. `wiki.json` 结构合法。
2. 成功页面都有 `.md` 与 `.meta.json`。
3. 每个页面都有对应的 `citations/*.citations.json`。
4. `version.json` 正确记录页面顺序、commit 和整体状态。

### 14.3 恢复门槛

恢复任务时必须先检查：

1. 配置是否发生不可兼容变化。
2. Provider 是否仍可用。
3. `job-state.json` 是否完整。
4. 版本草稿目录是否被部分写坏。

若任意一项失败，则提示从上一个安全阶段重启。

---

## 15. 安全、可靠性与性能

### 15.1 安全

1. 所有路径都必须经过 repo root 约束，禁止越界读取。
2. `bash_exec_ro` 只允许白名单命令。
3. 页面和引用渲染时默认转义 HTML。
4. 敏感配置只以掩码形式展示。

### 15.2 可靠性

1. 所有任务状态变更必须落盘后再发事件。
2. SSE 断连后可以基于 `Last-Event-ID` 或重新读取 `events.ndjson` 恢复。
3. 生成任务必须支持取消，取消后不更新 `current.json`。

### 15.3 性能

默认性能目标遵循 PRD 中“质量优先”的建议区间，不增加更激进目标。

工程侧约束：

1. 页面生成严格串行。
2. 单次窗口化读取默认不超过 240 行。
3. 单页内部实时本地检索并行上限遵循预设配置，默认最多 2 个子任务。

---

## 16. 测试与验收方案

### 16.1 测试分层

| 层级 | 范围 | 关键内容 |
| --- | --- | --- |
| 单元测试 | config/providers/storage/policy/validators | schema、边界、错误分支 |
| 集成测试 | generation/retrieval/ask/research | 本地 fixture 仓库、轻量清单、事件流 |
| Golden 测试 | catalog/page/chat/research | 固定输入下的结构化输出与引用格式 |
| UI 测试 | provider center / generate / wiki / chat | 页面状态与关键交互 |
| E2E 测试 | init -> generate -> browse -> ask | 主链路闭环 |

### 16.2 Fixture 仓库

至少维护这些 fixture：

1. `mini-ts-app`
2. `go-service`
3. `python-cli`
4. `monorepo-mixed`
5. `large-config-heavy-repo`

### 16.3 必测场景

1. 首次配置向导成功完成。
2. Provider 连通性失败时能给出明确错误。
3. Catalog 输出不合法时进入修复。
4. 单页失败后任务停在当前页，并可从 `job-state.json` 恢复。
5. 页面引用点击能打开源码抽屉。
6. 文档可答问题不会触发高成本代码检索。
7. `grep` 无命中时可降级到 `find / glob + read`。
8. 任务中断后可恢复。

### 16.4 发布验收清单

1. 新项目从 `init` 到 `generate` 成功。
2. 生成完成后 Web 可浏览、可切版本、可搜索。
3. CLI `ask` 与 Web Chat Dock 都能输出引用。
4. `doctor` 能识别不可用模型、清单损坏、恢复状态异常。
5. 所有文档中没有 `TODO/TBD`。

---

## 17. 开发顺序建议

建议按以下顺序落地：

1. `config + secrets + provider-center`
2. `storage + events + project model`
3. `repo profiler + catalog + lightweight manifests`
4. `catalog/page generation runtime`
5. `validation + publish + resume`
6. `web provider center + generate workbench + wiki shell`
7. `ask runtime + chat dock + CLI ask`
8. `research runtime + compare/search`

这个顺序的核心原因是：

1. 没有稳定配置中心，后续所有 runtime 都会反复返工。
2. 没有统一轻量清单和实时本地检索，问答和生成会变成两套系统。
3. 没有事件和恢复，CLI/Web 工作台都无法成立。
