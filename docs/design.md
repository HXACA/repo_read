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
  - init / providers / generate / jobs / ask / doctor / versions / browse / research
          │
          ├──── consume core services and events
          │
packages/web
  - bookshelf / jobs / reader / chat / research / providers
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
| `page` | `generate` 内部阶段 | 生成单页、审稿、校验、写入版本草稿 | `pages/*.md`、`pages/*.meta.json`、`review/*.review.json`、`validation/*.validation.json` |
| `ask` | CLI `ask` / Web Chat Dock | 基于当前页面和实时本地检索回答问题 | 流式回答、引用链、会话摘要 |
| `research` | CLI `research` / Web Research | 多步证据归并、形成结论 | 研究计划、研究过程、结论与引用 |

### 3.2 核心设计结论

1. 单主循环推进全局状态，成功路径固定为 `catalog -> page -> review -> validate -> publish`。
2. 页面生成必须严格串行，顺序固定为 `catalog -> page_01 -> review -> validate -> page_02 -> ...`。
3. 并行只允许发生在单页内部、互不重叠的实时本地检索，不允许跨页面并发写作。
4. `fresh.reviewer` 必须是独立新会话，不复用起草页的上下文。
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
| `review/` | `fresh.reviewer` 审稿、问题归类、修订建议 | `ReviewResult` |
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
| `commands/providers.ts` | 管理 Provider 凭证引用、角色模型映射、能力探测结果 |
| `commands/generate.ts` | 发起任务、展示串行阶段和当前页面 |
| `commands/jobs.ts` | 查看历史任务、恢复最近未完成页面 |
| `commands/versions.ts` | 查看版本列表、切换阅读目标 |
| `commands/browse.ts` | 启动本地 Web 服务并打印地址 |
| `commands/ask.ts` | 终端问答、显示引用摘要 |
| `commands/research.ts` | 深度研究终端模式 |
| `commands/doctor.ts` | 环境和状态诊断 |
| `components/` | 阶段时间线、页面进度表、引用摘要、错误面板、持续状态栏 |

### 4.3 `packages/web` 模块职责

| 模块 | 职责 |
| --- | --- |
| `app/` | 页面路由与 API Route Handlers |
| `features/providers/` | Provider 配置中心 |
| `features/generate/` | 生成工作台与任务追踪 |
| `features/projects/` | 项目书架页、项目概览、版本列表 |
| `features/wiki/` | 版本阅读页、页面详情页、源码抽屉、版本切换 |
| `features/search/` | 页面/文件/引用搜索 |
| `features/chat/` | 页面级 Chat Dock、会话管理、回答渲染 |
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

### 6.1 配置原则

V1 的配置系统只暴露最小可用面，避免把运行时策略泄露成用户需要理解的内部开关。

1. 用户只可配置角色级模型映射，不可按命令、阶段或页面分别指定模型。
2. 唯一可配置角色固定为 `main.author`、`fork.worker`、`fresh.reviewer`。
3. 每个角色只允许两个字段：`model` 与 `fallback_models`。
4. 凭证按 Provider 维度保存为引用，不在角色配置里重复保存密钥。
5. 系统按模型族维护系统内建 prompt 调优，不提供用户级 prompt 覆盖。
6. 系统负责能力探测、路由选择、fallback 顺序与降级，不把这些策略下放给用户。

### 6.2 配置来源与优先级

优先级从高到低：

1. Web/CLI 当前操作的显式参数
2. 项目级配置 `.reporead/projects/<project_slug>/project.json` 中的角色映射
3. 全局配置中的 Provider 凭证引用与默认角色映射
4. 环境变量提供的只读默认值

这里的“显式参数”只允许覆盖目标项目、目标版本和是否执行 `resume`，不允许注入新的 prompt 文本或临时改写内部路由策略。

### 6.3 用户可编辑配置模型

```ts
type RoleModelConfig = {
  model: string
  fallback_models: string[]
}

type ProjectRoleConfig = {
  'main.author': RoleModelConfig
  'fork.worker': RoleModelConfig
  'fresh.reviewer': RoleModelConfig
}

type ProviderCredentialConfig = {
  provider: string
  secretRef: string
  baseUrl?: string
  enabled: boolean
}

type UserEditableConfig = {
  projectSlug: string
  repoRoot: string
  preset: 'quality' | 'balanced' | 'budget' | 'local-only'
  providers: ProviderCredentialConfig[]
  roles: ProjectRoleConfig
}
```

约束如下：

1. `main.author` 负责 catalog 与 page draft 的主写作路径。
2. `fork.worker` 负责页内检索补证、局部比对、局部摘要、研究子任务等派生执行路径，但不改页面结构，也不写页面。
3. `fresh.reviewer` 只负责独立审稿，不复用起草上下文。
4. `fallback_models` 只声明候选顺序；真正是否可用由系统探测后决定。
5. 用户看不到内部 prompt 模板，也不能对单角色追加自定义 prompt。

### 6.4 系统解析后的 `ResolvedConfig`

```ts
type ResolvedRoleRoute = {
  role: 'main.author' | 'fork.worker' | 'fresh.reviewer'
  primaryModel: string
  fallbackModels: string[]
  resolvedProvider: string
  systemPromptTuningId: string
}

type ResolvedConfig = {
  projectSlug: string
  repoRoot: string
  preset: 'quality' | 'balanced' | 'budget' | 'local-only'
  roles: Record<'main.author' | 'fork.worker' | 'fresh.reviewer', ResolvedRoleRoute>
  providers: Array<{
    provider: string
    secretRef: string
    baseUrl?: string
    enabled: boolean
    capabilities: ModelCapability[]
  }>
  retrieval: {
    maxParallelReadsPerPage: number
    maxReadWindowLines: number
    allowControlledBash: boolean
  }
}
```

`ResolvedConfig` 由 `ProviderCenterService` 与 `ConfigResolver` 联合生成，不直接暴露给用户编辑。

### 6.5 Provider 配置向导

Provider 向导只做四类事情：

1. 发现本机可用 Provider，并为每个 Provider 建立凭证引用。
2. 检查角色所选模型是否存在、是否可认证、是否满足对应角色能力。
3. 生成最终角色路由摘要，明确主模型、fallback 链和当前命中的系统内建 prompt 调优。
4. 给出可执行建议，例如“`fresh.reviewer` 缺少 JSON schema 能力，请改用 fallback”。

向导不提供：

1. 自定义 prompt 编辑器。
2. 针对 `generate/ask/research` 的单命令模型分配。
3. 用户手动编排能力探测规则。

### 6.6 Provider 能力探测与 fallback

`ProviderCenterService` 对每个模型记录这些能力：

```ts
type ModelCapability = {
  model: string
  provider: string
  supportsStreaming: boolean
  supportsToolCalls: boolean
  supportsJsonSchema: boolean
  supportsLongContext: boolean
  supportsReasoningContent: boolean
  isLocalModel: boolean
  health: 'healthy' | 'degraded' | 'unavailable'
  checkedAt: string
}
```

运行规则：

1. `main.author` 至少需要流式输出、长上下文和稳定 Markdown 生成能力。
2. `fork.worker` 至少需要工具调用或结构化输出能力，用于页内检索补证。
3. `fresh.reviewer` 至少需要 JSON schema 或等价结构化输出能力，保证审稿结果可落盘。
4. 系统先尝试角色的 `model`，能力不足、认证失败或运行报错时，按 `fallback_models` 顺序继续。
5. 若主模型与 fallback 属于同一模型族，系统继续沿用同一套系统内建 prompt 调优；若跨模型族切换，则切到对应模型族的系统内建 prompt 调优。
6. 能力探测结果缓存到全局目录，避免每次启动重复探测；缓存过期或连续失败时强制重测。

### 6.7 系统内建 prompt 调优与预设

系统内部按模型族维护 prompt 模板，例如 `gpt-5.x`、`claude-opus/sonnet`、`qwen-coder`、`gemini-pro`。每个模型族都有自己的系统内建 prompt 调优，负责：

1. 角色 prompt 组织方式。
2. 引用格式和结构化输出约束。
3. 针对 `catalog`、`page`、page 审稿链路、`ask`、`research` 的细粒度系统内建 prompt 调优。
4. token 预算、压缩策略与工具调用风格。

预设只影响系统内部预算，不改变用户可编辑字段：

| 预设 | 角色使用倾向 | 页内检索上限 | 典型用途 |
| --- | --- | --- | --- |
| `quality` | 三角色分离，优先强模型 | 2 | 默认模式 |
| `balanced` | `main.author` 强模型，`fork.worker` 中档模型 | 2 | 一般仓库 |
| `budget` | 优先复用同一 Provider，缩短 fallback 链 | 2 | 成本敏感 |
| `local-only` | 只使用本地可用 Provider | 1 | 离线环境 |

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
        │       ├── review/
        │       │   └── <page_slug>.review.json
        │       └── validation/
        │           └── <page_slug>.validation.json
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
| `projects/<project_slug>/jobs/<job_id>/review/*.review.json` | `fresh.reviewer` 对 page 的独立审稿结果，记录问题、结论和修订建议 |
| `projects/<project_slug>/jobs/<job_id>/validation/*.validation.json` | 确定性 validator 的页级结果，记录结构/引用/Mermaid/链接校验明细 |
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
    summary: 'passed' | 'failed'
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

### 8.2 轻量清单与仓库画像

V1 只做轻量清单，不做重型索引构建。`catalog` 阶段的目标是回答“仓库是什么、页面该怎么排、先看哪里”，而不是把代码重新存一遍。

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

可恢复中断态单独记录为 `interrupted`；不可恢复异常终态记录为 `failed`，两者都不属于主成功路径。

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
    | 'interrupted'
    | 'failed'
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
| `reviewing` | 当前页草稿 | `review/*.review.json`，并把稳定审稿摘要回写到 `draft/<version_id>/pages/*.meta.json` | 必须由 `fresh.reviewer` 独立运行，失败留在当前页 |
| `validating` | 审稿后的页面与引用 | `validation/*.validation.json` 与稳定校验摘要，并更新 `draft/<version_id>/...` 中对应文件 | 失败留在当前页，允许修复后重试 |
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

`AskSession` 在 V1 中是进程内内存态会话，不进入版本目录，也不写入项目长期清单。浏览器刷新或 CLI 重连时，只要同一服务进程仍存活，就可以基于同一个 `sessionId` 继续消费内存事件缓冲区；进程退出、重启或用户显式清空后，ask 会话立即失效。只有 `research` 的结论性产物才持久化到 `research/`。

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

### 11.1 设计心智

Web 端是阅读器心智，不是通用 Agent 控制台。

1. 第一优先级是让用户稳定阅读版本化 Wiki、切换页面、查看引用和追踪任务。
2. 第二优先级是围绕当前页面发起 `ask` 和 `research`，而不是暴露底层 Agent 内部思维过程。
3. 任务过程只展示阶段、页级状态、审稿与校验结果，不展示噪声式工具日志瀑布。

### 11.2 路由与页面职责

| 路由 | 页面定位 | 核心内容 |
| --- | --- | --- |
| `/` | 首页 | 最近项目、最近任务、最近版本 |
| `/projects` | 项目书架页 | 项目卡片、当前版本、最近一次生成状态 |
| `/projects/:projectId` | 项目概览页 | 仓库画像、版本列表、最近 job、入口操作 |
| `/projects/:projectId/versions/:versionId` | 版本阅读页 | 左侧导航、版本摘要、页面列表、版本切换 |
| `/projects/:projectId/versions/:versionId/pages/:slug` | 页面页 | Markdown 正文、引用、源码抽屉、页面级 Chat Dock |
| `/projects/:projectId/jobs/:jobId` | Job 详情页 | 阶段时间线、当前页、恢复入口、最近 review/validate 结果 |
| `/projects/:projectId/versions/:versionId/search` | 搜索页 | 页面/文件/引用三种搜索视图 |
| `/projects/:projectId/versions/:versionId/research` | 研究工作区 | 研究计划、进度、结论与引用 |
| `/settings/providers` | Provider 配置中心 | Provider 凭证引用、角色模型与 fallback |

### 11.3 项目书架页

项目书架页强调“我有哪些仓库、每个仓库当前读到哪一版、最近一次生成是否健康”。

关键组件：

| 组件 | 职责 |
| --- | --- |
| `ProjectBookshelfGrid` | 以卡片网格展示全部项目 |
| `ProjectShelfCard` | 项目名、仓库路径、默认版本、最近 job 状态 |
| `RecentActivityStrip` | 最近完成版本、最近中断任务、最近研究结果 |
| `QuickActions` | 进入阅读、查看 Job、重新 generate |

交互规则：

1. 首页与书架页都可以进入项目概览，但书架页保留阅读器风格的卡片布局。
2. 卡片只展示高价值状态，不展示底层工具细节。

### 11.4 版本阅读页与页面页

版本阅读页用于浏览某个版本的整体结构；页面页用于聚焦单页阅读。

版本阅读页布局：

1. 左侧 `VersionSidebar`
   - `section/group/topic` 树
   - 页面数量、最后生成时间
   - 版本切换器
2. 中间 `VersionOverview`
   - `version.json` 摘要
   - 章节概览
   - 最近变更与研究入口
3. 右侧 `ReaderUtilityRail`
   - 搜索入口
   - 最近阅读页面
   - 最近问题摘要

页面页布局：

1. 左侧 `WikiSidebar`
   - 当前版本导航树
   - 页面间跳转
2. 中间 `WikiContent`
   - `WikiPageHeader`
   - `MarkdownPageRenderer`
   - `RelatedPageList`
3. 右侧 `PageUtilityRail`
   - TOC
   - `SourceDrawer`
   - `Chat Dock`

关键组件：

| 组件 | 职责 |
| --- | --- |
| `WikiPageHeader` | 标题、摘要、版本、commit、生成时间 |
| `MarkdownPageRenderer` | Markdown、Mermaid、引用芯片 |
| `CitationChip` | 点击后打开 `SourceDrawer` |
| `SourceDrawer` | 文件路径、行号、代码片段、引用解释 |
| `RelatedPageList` | 推荐阅读 |
| `Chat Dock` | 围绕当前页面发起 ask/research，会话只保存在内存态 |

页面级 `Chat Dock` 规则：

1. 默认锚定当前页面 slug，把它作为 `ask` 的第一页上下文。
2. 若问题超出当前页，服务端再触发页内检索或升级为 `research`。
3. `Chat Dock` 刷新后只在同一服务进程仍存活时保留 ask 会话；进程重启后必须重新发起 ask。
4. `Chat Dock` 不承担全局运维职责，不展示 job 控制按钮。

### 11.5 Job 详情页

Job 详情页是长任务的观察面板，不是通用控制台。页面应包含：

1. `JobSummaryCard`
   - job id、版本 id、当前 mode、当前阶段、当前页 slug
2. `StageTimeline`
   - `cataloging -> page_drafting -> reviewing -> validating -> publishing`
3. `PageQueueTable`
   - 每个页面的状态、最后更新时间、是否可 resume
4. `ReviewValidationPanel`
   - 最近一次 review 结论与最近一次 validate 结果
5. `FailurePanel`
   - 最近错误、恢复建议、`interrupt`/`resume` 轨迹

交互规则：

1. 页面刷新后根据 `jobId` 重新订阅 `/events`。
2. 任务 `interrupt` 后仍保留时间线、草稿入口和恢复点。
3. 任务成功后链接到新版本阅读页；失败或中断后停留在详情页。

---

## 12. CLI 详细设计

### 12.1 命令矩阵

V1 CLI 命令固定为 `init/providers/generate/jobs/ask/doctor/versions/browse/research`。

| 命令 | 行为 | 关键选项 |
| --- | --- | --- |
| `repo-read init` | 初始化项目绑定、默认预设、首次 Provider 引导 | `--preset`, `--repo` |
| `repo-read providers` | 管理 Provider 凭证引用、角色模型、能力探测和 fallback 链 | `--test`, `--json`, `--project` |
| `repo-read generate` | 发起新版本生成或从安全点 `resume` | `--resume`, `--note`, `--project` |
| `repo-read jobs` | 查看历史 job、跟踪当前 job、输出恢复建议 | `--latest`, `--watch`, `--project` |
| `repo-read ask` | 基于当前页或指定页发起终端问答 | `--page`, `--version`, `--clear` |
| `repo-read doctor` | 检查配置、凭证、清单、恢复点与目录健康 | `--json`, `--project` |
| `repo-read versions` | 展示版本列表、默认版本与发布状态 | `--project`, `--json` |
| `repo-read browse` | 启动本地 Web 阅读器并定位到项目/版本/页面 | `--port`, `--project`, `--version`, `--page` |
| `repo-read research` | 发起深度研究并输出结论与引用 | `--page`, `--version`, `--question` |

### 12.2 持续可见输出

所有长命令都使用统一状态栏，持续显示四类核心信息：

1. 当前 mode，例如 `catalog`、`page`、`ask`、`research`
2. 当前页 slug
3. 当前阶段，例如 `page_drafting`、`reviewing`、`validating`
4. 最近 review / validate 结果

具体形式：

1. 顶部 `CommandStatusBar` 常驻显示当前项目、版本、mode、当前页 slug。
2. 中部主体按命令展示阶段时间线、回答流、研究进度或版本列表。
3. 底部 `RecentChecksFooter` 固定显示最近一次审稿结论与最近一次结构校验状态。

### 12.3 各命令输出约束

`generate` 输出固定为五块：

1. 任务摘要
2. 持续状态栏
3. 阶段时间线
4. 页面进度表
5. 最新错误或恢复提示

`jobs` 输出固定为四块：

1. job 列表
2. 当前 job 详情
3. 最近 `interrupt` / `resume` 记录
4. 恢复建议

`ask` 输出固定为四块：

1. 上下文徽标
2. 持续状态栏
3. 流式答案
4. 引用摘要

`research` 输出固定为四块：

1. 研究计划
2. 子问题进度
3. 阶段性发现
4. 最终结论与引用

### 12.4 CLI 与 Web 的关系

1. CLI 是快速入口、自动化入口和运维诊断界面。
2. Web 是稳定阅读、版本切换、页面内问答和 Job 追踪界面。
3. CLI 不实现独立业务逻辑，只编排 `packages/core` 的服务与事件订阅。
4. `browse` 只是打开阅读器，不把 Web 变成第二套 CLI 控制台。
5. Web 通过 HTTP API 进入运行时；CLI 直接调用 `packages/core` 服务，但必须复用同一 DTO、状态语义和事件模型。

---

## 13. API 与事件契约

### 13.1 API 设计原则

1. Web 通过 HTTP API 进入核心运行时；CLI 直接调用 `packages/core` 服务。
2. 两个入口层必须复用同一 DTO、状态语义和事件模型，不允许分叉出第二套协议。
3. 生成、问答、研究的 Web 路由都挂在 `/api/projects/:projectId/...` 下，避免全局悬空 job。
4. 长任务状态通过 SSE 事件流暴露，HTTP 请求只负责启动、恢复和读取快照。

### 13.2 关键 HTTP API

#### `POST /api/projects/:projectId/generate`

作用：为指定项目创建新的 generate job。

请求体：

```ts
type GenerateRequest = {
  baseVersionId?: string
  note?: string
}
```

响应：

```ts
type GenerateResponse = {
  jobId: string
  versionId: string
  status: 'queued' | 'cataloging'
  eventStreamPath: string
}
```

#### `POST /api/projects/:projectId/jobs/:jobId/resume`

作用：从 `job-state.json` 指向的安全恢复点继续执行。

请求体：

```ts
type ResumeJobRequest = {
  forceFromStage?: 'cataloging' | 'page_drafting' | 'reviewing' | 'validating'
}
```

响应：

```ts
type ResumeJobResponse = {
  jobId: string
  resumedFrom: {
    stage: string
    pageSlug?: string
    checkpointAt: string
  }
  status: 'queued' | 'cataloging' | 'page_drafting' | 'reviewing' | 'validating'
}
```

#### `GET /api/projects/:projectId/jobs/:jobId/events`

作用：返回 job 级 SSE 事件流，用于 Web 详情页和 CLI `jobs --watch`。

请求参数：

```ts
type JobEventsQuery = {
  sinceEventId?: string
  replay?: boolean
}
```

输出为 `text/event-stream`，支持从 `events.ndjson` 回放。

#### `POST /api/projects/:projectId/ask`

作用：在当前版本、当前页面上下文下执行 `ask`。

请求体：

```ts
type AskRequest = {
  versionId: string
  pageSlug?: string
  question: string
  sessionId?: string
}
```

响应：

```ts
type AskAcceptedResponse = {
  sessionId: string
  mode: 'ask' | 'research'
  eventStreamPath: string
  status: 'streaming' | 'completed'
}
```

#### `POST /api/projects/:projectId/research`

作用：发起深度研究，必要时把结论写入 `versions/<versionId>/research/`。

请求体：

```ts
type ResearchRequest = {
  versionId: string
  pageSlug?: string
  question: string
  maxSubQuestions?: number
}
```

响应：

```ts
type ResearchAcceptedResponse = {
  sessionId: string
  status: 'planning' | 'running'
  eventStreamPath: string
}
```

#### `GET /api/projects/:projectId/ask/:sessionId/events`

作用：返回 `ask` 会话的 SSE 事件流，供 Web Chat Dock、CLI `ask` 订阅。

请求参数：

```ts
type AskEventsQuery = {
  sinceEventId?: string
  replay?: boolean
}
```

语义约束：

1. `POST /ask` 成功后，调用方必须连接 `eventStreamPath`，其值固定为 `/api/projects/:projectId/ask/:sessionId/events`。
2. `sessionId` 是 ask 会话唯一标识；Web Chat Dock 刷新或 CLI 重连时，只要同一服务进程仍存活，就可用同一个 `sessionId` 继续连接。
3. `replay=true` 或传入 `sinceEventId` 时，服务端只从同一服务进程存活期间的内存事件缓冲区补发缺失事件，再继续推送实时流。
4. ask 事件不会落盘，也不承诺跨进程恢复；若进程重启，调用方必须重新创建 ask 会话。

#### `GET /api/projects/:projectId/research/:sessionId/events`

作用：返回 `research` 会话的 SSE 事件流，供 Web Research、CLI `research` 订阅。

请求参数：

```ts
type ResearchEventsQuery = {
  sinceEventId?: string
  replay?: boolean
}
```

语义约束：

1. `POST /research` 成功后，调用方必须连接 `eventStreamPath`，其值固定为 `/api/projects/:projectId/research/:sessionId/events`。
2. `sessionId` 是 research 会话唯一标识；研究进行中的事件回放依赖同一服务进程存活期间的内存事件缓冲区。
3. 研究完成后的可回看能力以 `versions/<versionId>/research/` 下的结论产物为准，而不是承诺长期保留完整 SSE 事件流。
4. `sinceEventId` 用于断线重连与增量回放；若进程重启，调用方应重新进入研究视图并读取已落盘结论。

### 13.3 补充读取 API

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/projects` | 项目书架页数据 |
| `GET` | `/api/projects/:projectId` | 项目概览、默认版本、最近 job |
| `GET` | `/api/projects/:projectId/versions` | 版本列表 |
| `GET` | `/api/projects/:projectId/versions/:versionId` | 版本阅读页摘要 |
| `GET` | `/api/projects/:projectId/versions/:versionId/pages/:slug` | 页面页数据 |
| `GET` | `/api/projects/:projectId/versions/:versionId/search` | 页面/文件/引用搜索 |
| `GET` | `/api/projects/:projectId/versions/:versionId/source` | 源码片段读取 |
| `GET` | `/api/projects/:projectId/jobs/:jobId` | Job 详情快照 |
| `GET` | `/api/projects/:projectId/jobs/:jobId/events` | Job 级 SSE 事件流 |
| `POST` | `/api/projects/:projectId/jobs/:jobId/interrupt` | 中断当前长任务并写入恢复点 |
| `POST` | `/api/projects/:projectId/jobs/:jobId/resume` | 从安全恢复点继续 job |
| `GET` | `/api/projects/:projectId/ask/:sessionId/events` | ask SSE 事件流 |
| `GET` | `/api/projects/:projectId/research/:sessionId/events` | research SSE 事件流 |
| `GET` | `/api/config/providers` | 当前 Provider 摘要 |
| `PUT` | `/api/config/providers` | 保存 Provider 凭证引用与角色模型配置 |
| `POST` | `/api/config/providers/test` | 触发能力探测 |

### 13.4 统一事件封装

```ts
type AppEvent<T = unknown> = {
  id: string
  channel: 'job' | 'chat' | 'research'
  type: string
  at: string
  projectId: string
  jobId?: string
  versionId?: string
  pageSlug?: string
  payload: T
}
```

### 13.5 关键事件类型

事件流至少包含以下类型：

| Channel | 事件 | 说明 |
| --- | --- | --- |
| `job` | `job.started` | 新任务开始，写完初始 `job-state.json` 后发送 |
| `job` | `catalog.completed` | `wiki.json` 草案与页面顺序已落盘 |
| `job` | `page.drafting` | 当前页面进入起草阶段 |
| `job` | `page.reviewed` | `fresh.reviewer` 结果已写入 `review/*.review.json` |
| `job` | `page.validated` | 结构/引用/链接等校验已完成 |
| `job` | `job.interrupted` | 任务被用户中断或进程停止，恢复点已保存 |
| `job` | `job.resumed` | 任务从安全点继续执行 |
| `job` | `job.completed` | 发布完成，默认版本指针已更新 |
| `chat` | `chat.started` | 页面级问答开始 |
| `chat` | `chat.delta` | 流式答案片段 |
| `chat` | `chat.completed` | 问答完成并产出引用 |
| `research` | `research.plan` | 研究计划生成 |
| `research` | `research.progress` | 子问题推进 |
| `research` | `research.completed` | 研究结论完成 |

### 13.6 事件时序约束

1. 所有 `job.*` 事件必须在对应状态落盘后发送。
2. `page.reviewed` 之前必须已存在页草稿；`page.validated` 之前必须已存在 review 结果。
3. `job.interrupted` 与 `job.resumed` 必须携带恢复阶段和当前页 slug，便于 CLI/Web 无歧义重建状态栏。
4. `chat` 与 `research` 事件都必须使用各自的 `sessionId` 作为流标识；其中 ask 的 `sinceEventId` / `replay` 只在同一服务进程存活期间有效。

---

## 14. 校验、发布与恢复

### 14.1 独立校验链

结构、引用、链接校验必须独立运行，不能混入 `fresh.reviewer` 的 prompt 或依赖模型自由发挥。

页面校验分四层：

1. 结构校验
2. 引用校验
3. Mermaid 校验
4. 链接校验

执行顺序固定为：

```text
review result
  -> structure validator
  -> citation validator
  -> mermaid validator
  -> link validator
```

任何一层失败都不能直接发布该页。

### 14.2 草稿、审稿结果与恢复点保留策略

失败或中断时必须保留以下产物：

1. `draft/<version_id>/pages/*.md`
2. `draft/<version_id>/pages/*.meta.json`
3. `draft/<version_id>/citations/*.citations.json`
4. `review/*.review.json`
5. `validation/*.validation.json`
6. `job-state.json`
7. `events.ndjson`

保留规则：

1. 审稿失败保留当前草稿与最后一次成功审稿结果。
2. 校验失败保留当前草稿、最近一次 review 结果和 `validation/*.validation.json`。
3. `interrupt` 不删除任何中间产物，只追加事件并更新恢复点。

### 14.3 发布门槛

发布时必须满足：

1. `wiki.json` 结构合法。
2. 成功页面都有 `.md` 与 `.meta.json`。
3. 每个页面都有对应的 `citations/*.citations.json`。
4. 每个页面都至少完成一次独立 review 与一次独立 validate。
5. `version.json` 正确记录页面顺序、commit、发布摘要和整体状态。

发布策略：

1. 只接受完整版本，禁止半版本发布。
2. 发布前先对草稿版本做最终目录一致性检查。
3. 只有 `publishing` 原子提升成功后，才更新 `current.json` 默认指针。

### 14.4 恢复门槛与 `resume` 语义

恢复任务时必须先检查：

1. 配置是否发生不可兼容变化。
2. Provider 是否仍可用。
3. `job-state.json` 是否完整。
4. 草稿目录、review 目录与 `validation/` 目录是否一致。
5. 最近恢复点引用的页文件是否仍存在。

`resume` 规则：

1. 默认从 `job-state.json` 指向的最近安全阶段恢复。
2. 若当前页仅完成 draft，则从 `reviewing` 开始；若 review 已完成但 validate 失败，则从 `validating` 开始。
3. 若草稿目录损坏但 `wiki.json` 仍可用，则允许回退到 `cataloging` 重建草稿版本。
4. 若安全检查失败，系统拒绝自动恢复，并提示用户新开 generate job。

---

## 15. 安全、可靠性与性能

### 15.1 安全

1. 系统默认只读，不上传源码，不把仓库内容同步到远端存储。
2. 所有路径都必须经过 repo root 约束，禁止越界读取。
3. `bash_exec_ro` 只允许白名单命令。
4. 页面和引用渲染时默认转义 HTML。
5. 敏感配置只以掩码形式展示，密钥只以 Provider 维度的 `secretRef` 存在。

### 15.2 可靠性

1. 长任务允许慢，但必须可中断、可恢复。
2. 所有任务状态变更必须先落盘再发事件。
3. 只有 `job` SSE 断连后可以基于 `Last-Event-ID` 或重新读取 `events.ndjson` 恢复。
4. 生成任务 `interrupt` 后不得更新 `current.json`，且必须保留草稿与 review/validate 结果。
5. Web 刷新、CLI 重连和进程重启都应能从同一恢复点重建 `job` 状态；`ask` 仅支持同进程内存事件缓冲区重连，`research` 的长期回看依赖已落盘结论产物而不是流式过程恢复。

### 15.3 性能与并发边界

默认性能目标遵循 PRD 的“质量优先”，不为吞吐引入跨页并发。

工程侧约束：

1. 页面生成严格串行。
2. 并行只用于页内检索，不用于跨页写作、跨页审稿或跨页发布。
3. 单次窗口化读取默认不超过 240 行。
4. 单页内部实时本地检索并行上限遵循预设配置，默认最多 2 个子任务。
5. 任务事件与状态写盘采用 append/update 的轻量模式，不引入额外数据库。

---

## 16. 测试与验收方案

### 16.1 测试分层

测试分层至少包含单元、Contract 测试、集成、Golden、E2E。

| 层级 | 范围 | 关键内容 |
| --- | --- | --- |
| 单元测试 | config/providers/storage/policy/validators | 三角色配置 schema、fallback 解析、独立校验器、恢复点判定 |
| Contract 测试 | route handlers / DTO / SSE adapters | API DTO、SSE contract、job 事件顺序与 `events.ndjson` 回放、ask 进程内事件缓冲区失效语义、research 结论读取契约 |
| 集成测试 | generation/retrieval/ask/research | 本地 fixture 仓库、轻量清单、job 事件流、ask/research 内存流差异、`interrupt`/`resume` |
| Golden 测试 | catalog/page/chat/research | 固定输入下的页面结构、引用格式、事件序列与版本目录 |
| E2E 测试 | CLI + Web 主链路 | `init -> generate -> interrupt -> resume -> browse -> ask` |

### 16.2 Fixture 仓库

至少维护这些 fixture：

1. `mini-ts-app`
2. `go-service`
3. `python-cli`
4. `monorepo-mixed`
5. `large-config-heavy-repo`

其中 `monorepo-mixed` 必须覆盖多页面生成和页内检索补证，`large-config-heavy-repo` 必须覆盖长任务恢复与配置探测。

### 16.3 必测场景

1. 首次配置向导成功完成，并正确生成 `main.author`、`fork.worker`、`fresh.reviewer` 角色映射。
2. Provider 连通性失败或能力不足时，系统能自动切换到 `fallback_models` 并给出原因。
3. Catalog 输出不合法时进入修复，不推进到下一页。
4. 单页失败后任务停在当前页，并可从 `job-state.json` 恢复。
5. 页面引用点击能打开源码抽屉。
6. 文档可答问题不会触发高成本代码检索。
7. `grep` 无命中时可降级到 `find / glob + read`。
8. 任务 `interrupt` 后保留草稿、review 与 validate 结果，并能 `resume`。
9. Web 的书架页、版本阅读页、页面页、Job 详情页都能正确读取同一项目数据。
10. CLI 持续状态栏始终显示 mode、当前页 slug、当前阶段和最近 review / validate 结果。

### 16.4 E2E 与发布验收清单

E2E 主链路必须覆盖：

```text
init -> generate -> interrupt -> resume -> browse -> ask
```

发布验收清单：

1. 新项目从 `init` 到 `generate` 成功。
2. 任务被 `interrupt` 后可从安全点 `resume`。
3. 生成完成后 Web 可浏览、可切版本、可搜索。
4. CLI `ask` 与 Web Chat Dock 都能输出引用。
5. `doctor` 能识别不可用模型、清单损坏、恢复状态异常。
6. 所有文档中没有未收口的占位标记。

---

## 17. 开发顺序建议

建议按以下顺序落地：

1. `config + secrets + provider-center`
2. `storage + events + project model`
3. `repo profiler + catalog + 轻量清单`
4. `catalog/page generation runtime`
5. `validation + publish + resume`
6. `web provider center + generate workbench + wiki shell`
7. `ask runtime + chat dock + CLI ask`
8. `research runtime + compare/search`

这个顺序的核心原因是：

1. 没有稳定配置中心，后续所有 runtime 都会反复返工。
2. 没有统一轻量清单和实时本地检索，问答和生成会变成两套系统。
3. 没有事件和恢复，CLI/Web 工作台都无法成立。

## 18. V8 迭代增量

本节记录 V3 baseline 之后陆续落地、但前面章节尚未覆盖的增量特性。每一项都有自己的 git commit，本节只给 one-paragraph 参考。

### 18.1 Mechanism Coverage Guarantee（recall 保证）

**问题**：drafter 常以"看起来覆盖完整"通过 reviewer，但实际漏掉 ledger 里若干关键机制（缺少 citation 或 mention）。

**方案**：`packages/core/src/generation/mechanism-list.ts` 的 `deriveMechanismList` 从 evidence ledger 派生一份"本页应覆盖的机制"清单；outline planner 必须把每条机制要么分配到某个 section 的 `covers_mechanisms`，要么明确列入 `out_of_scope_mechanisms` 并给出 ≥10 字的理由。reviewer 按模式决定是否 block：
- `off`：不派生，不检查（preset 默认）
- `warn`：派生+统计，不触发 revision
- `strict`：未解析的 `missing_coverage` 视同 `missing_evidence`，触发 re-draft

**Audit**：`excessOutOfScopeIds` 加了一道阈值——`out_of_scope_mechanisms` 数量不得超过总机制数的 50%，超过部分视作 uncovered，回到 retry/force-allocate 链路，防止 outline 用"全部打发走"绕过覆盖要求。

### 18.2 两级 Rate Limiter（per-provider + per-model）

**问题**：`kingxliu` 个人套餐触发 HTTP 429 `Token Plan` 并发限流。ai-sdk 内部 3 次退避后抛到我们的代码，让 page fail。

**方案**：`packages/core/src/utils/rate-limiter.ts` 的 `TokenBucket` + `createRateLimitedFetch`。两级叠加——请求必须同时过模型级桶（`provider:model` key）和 provider 级桶（`provider` key）。配置入口是 `ProviderCredentialConfig.rateLimit` 与 `ProviderModelConfig.rateLimit`，各有 `maxConcurrent` + `minIntervalMs`。Streaming-aware——permit 在 body 真正读完/cancel/error 时才释放，否则长 SSE 会让并发假超限。

### 18.3 Wall-clock Timeout

**问题**：SSE inter-chunk timeout（120s 无数据）无法拦截 "慢速滴 token" 的流；bucket.acquire() 没超时机制，permit 泄漏时死锁。观测到 netpoll resume 1h 无任何 CPU/socket 活动。

**方案**：`createWallClockFetch` 外层 wrap 整个 fetch chain，默认 10min 硬上限。`AbortController` 信号贯穿到 `bucket.acquire(signal?)` 和底层 fetch。`Semaphore.acquire(signal?)` 让 aborted waiter 自己出队，不堵塞后续 waiter。超时触发抛 `WallClockTimeoutError`，页面 fail 而不是 hang 到宇宙热寂。

### 18.4 Adaptive Drafter Step Budget（revision 收紧）

**问题**：drafter 在 revision attempts 里仍花大量 round 做工具调用；初始 draft 100 步够用，第 2 次 revision 也跑 100 步就是浪费。

**方案**：`revisionStepBudget(baseMaxSteps, attempt)` 按 attempt 递减——初始 100%，第一次 revision 60%，第二次及以后 40%（floor 4）。pipeline 在调用 `activeDrafter.draft(...)` 时传 `{ maxSteps }` override。实测 hermes V6→V7 revision token 消耗降约 50%。

### 18.5 Terminal-Attempt L2 Suppression

**问题**：`selectVerificationLevel` 在 `revisionAttempt > 1` 时强制 L2（带工具验证）。但到达 `maxRevisionAttempts` 时已经无法再 revise——L2 verdict=revise 只能把页标 degraded，验证本身是浪费。

**方案**：`VerificationLevelInput` 加 `maxRevisionAttempts?` 字段。到达 terminal attempt 且唯一升级原因是 `revisionAttempt > 1` 时，降级回 L1。真实质量信号（`factualRisksCount > 0` 等）依旧触发 L2，defensible 覆盖不丢。

### 18.6 Evidence Ledger target/locator Split

**问题**：evidence-coordinator 的 `toLedgerEntry` 把 worker 分离输出的 `target` + `locator` 融合成 `"file:line"` 单字符串。mechanism-list 的 scope check `coveredSet.has(entry.target)` 永远匹配不到，V3 导致虚假 895 `unresolvedJob`，V7 P1 filter 把所有机制过滤成 0。

**方案**：`evidence_ledger` 类型加 optional `locator` 字段；`toLedgerEntry` 保持分离；dedup key 用 `kind+target+locator`；`splitLegacyFusedTarget` 兼容老 ledger JSON（resume 路径）。下游 drafter/outline prompt 在渲染时复合 `target:locator`。netpoll V8 实测 `coverageAudit.totalMechanismsJob=85, unresolved=0`，第一次看到真实数据。

### 18.7 Incremental Throughput Save + Resume Seed

**问题**：`throughput.json` 只在 job 结束时写；reboot/kill mid-job 丢所有已完成页的数据；resume 只记录本次 session 的页。

**方案**：`ThroughputReportBuilder.seed(report)` 加载磁盘已有报告；`snapshot()` 非破坏性快照供每页完成后落盘；`addPage` 按 slug dedup；`setCatalog` 在 resume 场景下保护 seeded catalog metric。任何崩溃点 throughput.json 都反映到那一刻。

### 18.8 Diagnostics: Heartbeat + SIGUSR1 + Stall Detector

**问题**：hang 无自愈外看不到（UI 刷新靠 spinner，events.ndjson 只在 transition 落盘，看 mtime 判断不准），无法诊断。

**方案**：`packages/core/src/utils/diagnostics.ts` 的 `Diagnostics` 类：
- **Heartbeat**：每 60s emit `job.heartbeat`，events.ndjson mtime 持续推进
- **Stall detector**：heartbeat 回调检查 `emitter.millisSinceLastMeaningful()` > 15min 则 emit `job.stalled`（一次 per stall window）
- **SIGUSR1 dump**：`kill -USR1 <pid>` 写 `<jobDir>/hang-dump-<ts>.json`，含 `process.getActiveResourcesInfo()` + memory + job label。仅 POSIX 平台（macOS / Linux）；Windows 没有 SIGUSR1 信号，Node 在 Windows 上忽略。且 `node --inspect` 会抢占该信号做 debugger 唤醒，不要在待诊断的进程上加 inspector flag

### 18.9 Drafter 空输出硬化

**问题**：某些 provider（kingxliu）在 tool-calling 多轮后返回 HTTP 200 空 body。drafter 的 `parseOutput` 把空输出当 `{success: true, markdown: ""}` 悄悄放过，pipeline 再以泛化消息判 fail，诊断信息全丢。

**方案**：`page-drafter.ts:draft` 在 `parsed.success && !parsed.markdown?.trim()` 时返回 `{success: false, error: "Drafter produced empty output (finishReason=..., rawTextLength=...)"}`，错误信息直达 event 和 log。
