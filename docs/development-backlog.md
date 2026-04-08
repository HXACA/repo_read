# RepoRead 开发任务拆解文档

> 版本：v1.0
> 更新时间：2026-04-08
> 文档定位：把现有设计文档转成可执行的开发 backlog / issue 清单
> 关联文档：
> - [产品需求文档（PRD）](./prd.md)
> - [工程整体设计文档](./design.md)
> - [核心 Agent 架构设计文档](./agent-architecture.md)
> - [设计思路说明](./design-rationale.md)
> - [完整 Issue 清单](./development-issues.md)

---

## 1. 文档目标

这份文档用于把当前设计落成开发任务，不再讨论方向是否正确，而是回答：

1. 先做什么，后做什么。
2. 每个模块要交付什么。
3. 每个任务的依赖是什么。
4. 什么状态算“可以合并”，什么状态还不能进入下一阶段。

本文默认目标是：

- 进入 V1 开发。
- 先打通 `init -> generate -> interrupt -> resume -> browse -> ask` 主链路。
- 保持“单主循环 + 两种委派原语 + 确定性 validator + 轻量清单 + 实时本地检索”的边界不漂移。

---

## 2. 使用方式

建议把本文直接作为 issue/backlog 的母文档使用。

推荐拆解方式：

- `Epic` 作为里程碑或项目阶段。
- `Task` 作为单个 issue。
- 每个 `Task` 应控制在一次明确提交或一组紧密相关提交内完成。

建议每个 issue 至少保留以下字段：

- 任务 ID
- 标题
- 目标
- 涉及目录
- 依赖
- 完成定义
- 测试点

---

## 3. 拆解原则

### 3.1 优先级原则

任务按以下顺序推进：

1. 先搭稳定工程骨架。
2. 再完成配置、Provider、存储和事件基础设施。
3. 再完成 `catalog -> page -> review -> validate -> publish -> resume` 主链路。
4. 再补齐 Web / CLI 工作台。
5. 最后补 `ask` 与 `research`。

### 3.2 并行原则

允许并行：

- 不同包下互不冲突的 UI 壳层工作。
- 不同 core 模块中边界清晰、写集不重叠的任务。
- 测试补充与文档补充。

不建议并行：

- `storage` 和 `generation` 的核心协议设计。
- `events` 与 Web/CLI 的最终事件契约。
- `review/validation/publish/resume` 的状态机闭环。

### 3.3 完成定义原则

默认完成定义包括 4 项：

1. 代码落地。
2. 类型和接口可用。
3. 对应测试补齐。
4. 文档与命名不偏离主设计文档。

---

## 4. 总体里程碑

| 里程碑 | 目标 | 对应任务 |
| --- | --- | --- |
| M0 | 工程脚手架与公共基础可运行 | B001-B004 |
| M1 | 配置、密钥、Provider 路由可用 | B010-B016 |
| M2 | 存储、事件、项目模型可用 | B020-B026 |
| M3 | 仓库画像、Catalog、轻量清单可用 | B030-B036 |
| M4 | 页面生成、审稿、校验、发布、恢复闭环可用 | B040-B050 |
| M5 | Web 基础工作台可用 | B060-B068 |
| M6 | CLI 主链路可用 | B070-B078 |
| M7 | `ask` 问答链路可用 | B080-B086 |
| M8 | `research` 研究链路可用 | B090-B096 |
| M9 | 集成验证与发布门槛检查完成 | B100-B104 |

进入下一里程碑前，上一里程碑的阻断项必须全部清空。

---

## 5. Backlog 总表

| ID | 任务 | 级别 | 依赖 | 备注 |
| --- | --- | --- | --- | --- |
| B001 | Monorepo 基础脚手架 | P0 | 无 | 工程起点 |
| B002 | 共享 TS / lint / test 基础设施 | P0 | B001 | 所有包共用 |
| B003 | `packages/core` 基础目录与公共类型 | P0 | B001 | Core 起点 |
| B004 | `packages/web` / `packages/cli` 最小壳层 | P0 | B001 | 先能启动 |
| B010 | 用户可编辑配置 schema | P0 | B002,B003 | `config/` |
| B011 | 密钥引用与 Provider 凭证存储 | P0 | B010 | `secrets/` |
| B012 | Provider 抽象与能力探测模型 | P0 | B010 | `providers/` |
| B013 | 角色路由与 fallback 解析 | P0 | B012 | 三角色固定 |
| B014 | Provider Center Service | P0 | B011,B012,B013 | 核心服务 |
| B015 | CLI `init` / `providers` 初版 | P0 | B014,B004 | 主入口 |
| B016 | Web `/settings/providers` 初版 | P1 | B014,B004 | UI 壳层 |
| B020 | `.reporead` 目录协议与 StorageAdapter | P0 | B003 | 状态基础 |
| B021 | 项目模型与 `project.json` | P0 | B020 | 项目入口 |
| B022 | 统一事件类型与 `events.ndjson` | P0 | B020 | CLI/Web 共用 |
| B023 | SSE 适配层 | P0 | B022 | Web 必需 |
| B024 | `job-state.json` 读写与恢复准源 | P0 | B020 | resume 核心 |
| B025 | CLI `jobs` / `versions` 初版 | P1 | B021,B024 | 可观测性 |
| B026 | Web `/projects` / 项目页基础读取 | P1 | B021,B023 | 浏览入口 |
| B030 | Repo Profiler | P0 | B021 | `project/` |
| B031 | Ignore/路径策略与受控只读边界 | P0 | B030 | `policy/` |
| B032 | 实时本地检索工具封装 | P0 | B030,B031 | `tools/` + `retrieval/` |
| B033 | Catalog Planner | P0 | B030,B032 | `catalog/` |
| B034 | 轻量清单与 `wiki.json` 草案落盘 | P0 | B033,B020 | 目录产物 |
| B035 | Catalog 校验与失败重试 | P1 | B033,B034 | 进入 page 前把关 |
| B036 | Catalog Golden Fixtures | P1 | B033 | 稳定输出 |
| B040 | GenerationJob 状态机 | P0 | B024,B034 | 主链路骨架 |
| B041 | Page Draft Runtime | P0 | B040,B032 | `generation/` |
| B042 | `fork.worker` 委派协议 | P0 | B041 | 页内并行补证 |
| B043 | `fresh.reviewer` 协议与结果落盘 | P0 | B041,B014 | 独立审稿 |
| B044 | `validator` 链 | P0 | B041,B043 | 结构/引用/链接/Mermaid |
| B045 | Publisher 与版本原子提升 | P0 | B044,B020 | 发布闭环 |
| B046 | Interrupt / Resume 流程 | P0 | B040,B044,B045 | 主链路必须 |
| B047 | 页面元数据与引用账本 | P1 | B041,B044 | 页面级信息 |
| B048 | Generation 事件发射与回放 | P0 | B040,B022 | CLI/Web 观测 |
| B049 | Page/Review/Validation 集成测试 | P0 | B041-B048 | 主链路验收 |
| B050 | 主链路 Golden 与样例仓库校验 | P1 | B049 | 质量门槛 |
| B060 | Web Provider Center | P1 | B016 | 可视配置 |
| B061 | Web Generate Workbench | P1 | B048,B023 | 发起任务 |
| B062 | Web Job 详情页 | P1 | B048,B023 | 过程追踪 |
| B063 | Web 版本阅读页 | P1 | B045,B023 | 阅读入口 |
| B064 | Web 页面页与 Markdown Renderer | P1 | B063 | 核心体验 |
| B065 | Source Drawer / Citation Chip | P1 | B047,B064 | 引用闭环 |
| B066 | 搜索页（页面/文件/引用） | P2 | B063,B065 | 阅读增强 |
| B067 | Web 版本切换与最近阅读 | P2 | B063 | 阅读补强 |
| B068 | Web E2E 基线 | P1 | B061-B065 | 回归 |
| B070 | CLI `generate` 主链路 | P0 | B048,B015 | 发起与状态栏 |
| B071 | CLI 持续状态栏与阶段时间线 | P1 | B070 | 可见性 |
| B072 | CLI `browse` | P1 | B063,B004 | 本地阅读桥 |
| B073 | CLI `doctor` | P1 | B014,B024 | 诊断 |
| B074 | CLI `ask` 壳层 | P1 | B080 | 问答入口 |
| B075 | CLI `research` 壳层 | P2 | B090 | 研究入口 |
| B076 | CLI 输出 contract 测试 | P1 | B070-B075 | 稳定输出 |
| B077 | CLI/Web 共享事件消费适配 | P1 | B048,B023 | 一致性 |
| B078 | CLI 主链路 E2E | P0 | B070-B077 | 发布必测 |
| B080 | AskService 路由判定 | P0 | B063,B032 | `ask/` |
| B081 | Ask 会话内存态管理 | P0 | B080 | `AskSession` |
| B082 | 页面优先检索与补证链路 | P0 | B080,B032 | page-first |
| B083 | Chat Dock 流式事件 | P1 | B081,B023 | Web 问答 |
| B084 | CLI `ask` 流式输出与引用摘要 | P1 | B081 | 终端问答 |
| B085 | Ask Contract / Integration 测试 | P0 | B082-B084 | V1 验收项 |
| B086 | “先页面后检索”回归用例 | P1 | B085 | 关键心智检查 |
| B090 | ResearchService 计划生成 | P1 | B032,B080 | `research/` |
| B091 | 研究子问题拆分与局部归并 | P1 | B090,B042 | 可用 worker |
| B092 | 研究结论落盘到 `research/` | P1 | B020,B090 | 可回看 |
| B093 | Web Research 工作区 | P2 | B092,B023 | UI |
| B094 | CLI `research` 流式呈现 | P2 | B092 | 终端 |
| B095 | Research 集成测试 | P1 | B090-B094 | 稳定性 |
| B096 | 研究与问答边界回归 | P2 | B095 | 路由准确性 |
| B100 | Fixture 仓库建设 | P0 | B002 | 测试前置 |
| B101 | E2E 主链路 `init -> generate -> interrupt -> resume -> browse -> ask` | P0 | B015,B070,B072,B074,B085 | 发布基线 |
| B102 | 样例仓库人工验收记录模板 | P1 | B100 | 发布流程 |
| B103 | 文档回链与入口整理 | P2 | 当前文档体系 | 降低协作成本 |
| B104 | 发布前 checklist 固化 | P1 | B101,B102 | 上线门槛 |

---

## 6. 详细任务拆解

### Epic M0: 工程脚手架与公共基础

#### B001 Monorepo 基础脚手架

- 目标：建立 `packages/core`、`packages/web`、`packages/cli` 的 monorepo 基础结构。
- 涉及目录：`packages/`, `pnpm-workspace.yaml`, 根目录配置。
- 依赖：无。
- 完成定义：
  - workspace 可安装依赖。
  - 三个 package 都能被 TypeScript 正确解析。
  - 根目录命令可执行 `build/test/lint`。
- 测试点：workspace 依赖安装、基础构建通过。

#### B002 共享 TS / lint / test 基础设施

- 目标：统一 tsconfig、eslint、vitest/jest、格式化与路径别名。
- 涉及目录：根配置、`packages/*/tsconfig.json`。
- 依赖：B001。
- 完成定义：
  - 三个 package 共享一套基础规则。
  - core 类型能被 web/cli 直接消费。
  - 测试命令具备按包执行能力。
- 测试点：空测试运行通过，类型检查通过。

#### B003 `packages/core` 基础目录与公共类型

- 目标：建好 `config/providers/project/storage/events/tools/...` 目录与公共类型入口。
- 涉及目录：`packages/core/src/`.
- 依赖：B001,B002。
- 完成定义：
  - 目录结构与 [design.md](/Users/jyxc-dz-0100318/open_source/repo_read/docs/design.md#L109) 一致。
  - 有统一 `types` 出口。
  - 核心 DTO 可被引用。
- 测试点：类型导出 smoke test。

#### B004 `packages/web` / `packages/cli` 最小壳层

- 目标：Web 能启动空壳页面，CLI 能输出帮助信息。
- 涉及目录：`packages/web`, `packages/cli`.
- 依赖：B001,B002。
- 完成定义：
  - Web 首页可打开。
  - CLI 有基础命令框架。
  - 可接入 core。
- 测试点：web dev、cli help smoke test。

### Epic M1: 配置、密钥与 Provider 路由

#### B010 用户可编辑配置 schema

- 目标：实现 `UserEditableConfig`、`ProjectRoleConfig`、`RoleModelConfig` 的 schema 与解析。
- 涉及目录：`packages/core/src/config`.
- 依赖：B003。
- 完成定义：
  - 仅支持三角色配置。
  - 仅支持 `model` / `fallback_models`。
  - 无 prompt override 字段。
- 测试点：schema 单元测试、非法配置拒绝。

#### B011 密钥引用与 Provider 凭证存储

- 目标：实现 `secretRef` 读写、掩码展示和凭证引用解析。
- 涉及目录：`packages/core/src/secrets`.
- 依赖：B010。
- 完成定义：
  - 凭证不直接混入角色配置。
  - CLI/Web 都只能读到掩码视图。
- 测试点：secret store 单元测试。

#### B012 Provider 抽象与能力探测模型

- 目标：建立 Provider 接口、`ModelCapability`、健康检查与能力探测结果模型。
- 涉及目录：`packages/core/src/providers`.
- 依赖：B010。
- 完成定义：
  - 支持 streaming/tool/json schema/long context 能力描述。
  - 探测结果可缓存。
- 测试点：mock provider contract test。

#### B013 角色路由与 fallback 解析

- 目标：把用户配置解析成 `ResolvedConfig` 和三角色路由。
- 涉及目录：`packages/core/src/config`, `packages/core/src/providers`.
- 依赖：B012。
- 完成定义：
  - 三角色路由解析正确。
  - fallback 顺序稳定。
  - 预设能影响内部预算，但不扩用户配置面。
- 测试点：fallback 解析单元测试。

#### B014 Provider Center Service

- 目标：统一配置解析、能力探测、路由选择和系统内建 prompt tuning 绑定。
- 涉及目录：`packages/core/src/providers`, `packages/core/src/config`.
- 依赖：B011,B012,B013。
- 完成定义：
  - 能输出最终角色路由摘要。
  - 能给出不可用模型的解释原因。
- 测试点：provider center 集成测试。

#### B015 CLI `init` / `providers` 初版

- 目标：打通最小初始化向导和 provider 管理。
- 涉及目录：`packages/cli/src/commands`.
- 依赖：B014,B004。
- 完成定义：
  - `init` 能绑定项目。
  - `providers` 能查看、测试、写入角色映射。
- 测试点：CLI 命令 smoke + contract test。

#### B016 Web `/settings/providers` 初版

- 目标：提供最小 Provider 配置中心页面。
- 涉及目录：`packages/web/src/features/providers`.
- 依赖：B014,B004。
- 完成定义：
  - 可查看凭证引用、角色模型和 fallback。
  - 可展示能力探测结果。
- 测试点：页面渲染和表单 contract test。

### Epic M2: 存储、事件与项目模型

#### B020 `.reporead` 目录协议与 StorageAdapter

- 目标：实现 [design.md](/Users/jyxc-dz-0100318/open_source/repo_read/docs/design.md#L437) 定义的目录协议。
- 涉及目录：`packages/core/src/storage`.
- 依赖：B003。
- 完成定义：
  - 项目、版本、job、draft、review、validation、research 目录结构可创建。
  - 读写 API 稳定。
- 测试点：storage 单元测试。

#### B021 项目模型与 `project.json`

- 目标：建立项目注册、项目摘要和默认版本指针模型。
- 涉及目录：`packages/core/src/project`, `packages/core/src/storage`.
- 依赖：B020。
- 完成定义：
  - 项目列表可读。
  - 默认版本与 repoRoot 可追踪。
- 测试点：project model 单元测试。

#### B022 统一事件类型与 `events.ndjson`

- 目标：定义 `AppEvent`、事件序列化和事件落盘。
- 涉及目录：`packages/core/src/events`.
- 依赖：B020。
- 完成定义：
  - job/ask/research 事件统一封装。
  - 能顺序回放。
- 测试点：event serialization contract test。

#### B023 SSE 适配层

- 目标：把 core 事件流暴露给 Web。
- 涉及目录：`packages/web/src/server`, `packages/core/src/events`.
- 依赖：B022。
- 完成定义：
  - Web 可订阅 job/ask/research 事件。
  - 中断与重连语义清晰。
- 测试点：SSE contract test。

#### B024 `job-state.json` 读写与恢复准源

- 目标：实现任务状态快照和恢复读取。
- 涉及目录：`packages/core/src/storage`, `packages/core/src/generation`.
- 依赖：B020。
- 完成定义：
  - 任何阶段切换都先写 `job-state.json`。
  - 恢复只认 `job-state.json`。
- 测试点：恢复状态单元测试。

#### B025 CLI `jobs` / `versions` 初版

- 目标：终端查看历史 job、默认版本和恢复建议。
- 涉及目录：`packages/cli/src/commands`.
- 依赖：B021,B024。
- 完成定义：
  - `jobs` 可看最新任务状态。
  - `versions` 可列出版本。
- 测试点：CLI contract test。

#### B026 Web `/projects` / 项目页基础读取

- 目标：提供项目列表和项目概览页最小读模型。
- 涉及目录：`packages/web/src/features/projects`.
- 依赖：B021,B023。
- 完成定义：
  - 项目页可显示 repo 路径、当前版本、最近 job。
- 测试点：SSR/read model test。

### Epic M3: Repo Profiler、Catalog 与轻量清单

#### B030 Repo Profiler

- 目标：实现仓库扫描、入口发现、语言/框架识别、顶层画像。
- 涉及目录：`packages/core/src/project`.
- 依赖：B021。
- 完成定义：
  - 可生成 `RepoProfile`。
  - 输出可被 catalog 直接消费。
- 测试点：fixture 仓库 profiler 集成测试。

#### B031 Ignore/路径策略与受控只读边界

- 目标：实现 `.gitignore`、额外 ignore、路径防护与只读命令白名单。
- 涉及目录：`packages/core/src/policy`, `packages/core/src/tools`.
- 依赖：B030。
- 完成定义：
  - 路径越界被拒绝。
  - 非白名单命令不可执行。
- 测试点：policy 单元测试。

#### B032 实时本地检索工具封装

- 目标：实现 `Read/Grep/Find/Git/Bash/PageRead/CitationOpen` 的基础服务层。
- 涉及目录：`packages/core/src/tools`, `packages/core/src/retrieval`.
- 依赖：B030,B031,B020。
- 完成定义：
  - 检索顺序与主文档一致。
  - 支持窗口化读取与结果标准化。
- 测试点：tool adapter contract test。

#### B033 Catalog Planner

- 目标：实现 `catalog` mode 的主控执行和输出解析。
- 涉及目录：`packages/core/src/catalog`, `packages/core/src/agents`.
- 依赖：B030,B032,B014。
- 完成定义：
  - 输出章节树、页面顺序、level、section、group。
  - 失败时支持有限重试。
- 测试点：catalog golden test。

#### B034 轻量清单与 `wiki.json` 草案落盘

- 目标：把 catalog 结果落到 draft/version 清单里。
- 涉及目录：`packages/core/src/catalog`, `packages/core/src/storage`.
- 依赖：B033,B020。
- 完成定义：
  - `wiki.json` 草案可读。
  - 页面顺序和依赖可恢复。
- 测试点：storage + catalog 集成测试。

#### B035 Catalog 校验与失败重试

- 目标：catalog 输出不合法时可重试，不直接推进 page。
- 涉及目录：`packages/core/src/catalog`, `packages/core/src/validation`.
- 依赖：B033,B034。
- 完成定义：
  - 无效输出被阻断。
  - 进入 page 前一定有合法 catalog。
- 测试点：非法 catalog repair/retry 测试。

#### B036 Catalog Golden Fixtures

- 目标：固定输入下输出稳定章节树。
- 涉及目录：`tests/fixtures`, `packages/core/src/catalog`.
- 依赖：B033。
- 完成定义：
  - 至少覆盖 3 类仓库。
- 测试点：golden test。

### Epic M4: 生成、审稿、校验、发布、恢复

#### B040 GenerationJob 状态机

- 目标：实现 `queued -> cataloging -> page_drafting -> reviewing -> validating -> publishing -> completed`。
- 涉及目录：`packages/core/src/generation`.
- 依赖：B024,B034。
- 完成定义：
  - 中断态和失败态独立处理。
  - 每次状态切换具备事件和落盘。
- 测试点：状态机单元测试。

#### B041 Page Draft Runtime

- 目标：实现严格串行的 page 生成主流程。
- 涉及目录：`packages/core/src/generation`, `packages/core/src/agents`.
- 依赖：B040,B032,B014。
- 完成定义：
  - 一次只起草一页。
  - 草稿和页面 meta 正确落盘。
- 测试点：page runtime 集成测试。

#### B042 `fork.worker` 委派协议

- 目标：支持单页内部局部并行补证。
- 涉及目录：`packages/core/src/agents`, `packages/core/src/retrieval`.
- 依赖：B041。
- 完成定义：
  - 只接受窄 directive。
  - 结构化返回 findings/citations/open_questions。
- 测试点：worker protocol contract test。

#### B043 `fresh.reviewer` 协议与结果落盘

- 目标：支持独立审稿与审稿结果落盘。
- 涉及目录：`packages/core/src/review`, `packages/core/src/agents`, `packages/core/src/storage`.
- 依赖：B041,B014。
- 完成定义：
  - fresh session 审稿。
  - 输出 blocker/risk/missing evidence/scope violation。
- 测试点：review schema test。

#### B044 `validator` 链

- 目标：实现结构、引用、链接、Mermaid 四类确定性校验。
- 涉及目录：`packages/core/src/validation`.
- 依赖：B041,B043。
- 完成定义：
  - 未通过校验的页面不可发布。
  - 报告可落盘并被 CLI/Web 读取。
- 测试点：validator 单元 + golden。

#### B045 Publisher 与版本原子提升

- 目标：把 draft 原子提升为 version，并更新 current 指针。
- 涉及目录：`packages/core/src/wiki`, `packages/core/src/storage`.
- 依赖：B044,B020。
- 完成定义：
  - 发布时不会污染半成品版本。
  - 成功后版本可直接浏览。
- 测试点：publish integration test。

#### B046 Interrupt / Resume 流程

- 目标：支持中断恢复、失败页重试和从安全点续跑。
- 涉及目录：`packages/core/src/generation`, `packages/core/src/storage`.
- 依赖：B040,B044,B045。
- 完成定义：
  - 中断保留草稿、review、validate 结果。
  - `resume` 只从安全点恢复。
- 测试点：interrupt/resume integration test。

#### B047 页面元数据与引用账本

- 目标：建立页面 meta、引用记录和源码跳转信息。
- 涉及目录：`packages/core/src/wiki`, `packages/core/src/storage`.
- 依赖：B041,B044。
- 完成定义：
  - 页面页能打开 Source Drawer。
  - 引用可回链到文件/页面/commit。
- 测试点：citation open test。

#### B048 Generation 事件发射与回放

- 目标：把生成主链路完整映射成统一事件。
- 涉及目录：`packages/core/src/events`, `packages/core/src/generation`.
- 依赖：B040,B022。
- 完成定义：
  - CLI/Web 都能消费同一事件。
  - `interrupt` / `resume` 带恢复阶段与当前页 slug。
- 测试点：event order contract test。

#### B049 Page/Review/Validation 集成测试

- 目标：把 page、review、validation、publish、resume 串起来测。
- 涉及目录：测试目录全局。
- 依赖：B041-B048。
- 完成定义：
  - 跑通至少一个完整 fixture。
- 测试点：integration suite。

#### B050 主链路 Golden 与样例仓库校验

- 目标：建立可回归的主链路输出基线。
- 涉及目录：测试目录全局。
- 依赖：B049。
- 完成定义：
  - 页面结构、引用格式、事件序列稳定。
- 测试点：golden + manual validation。

### Epic M5: Web 基础工作台

#### B060 Web Provider Center

- 目标：完善 Provider 配置中心交互。
- 涉及目录：`packages/web/src/features/providers`.
- 依赖：B016。
- 完成定义：
  - 可查看健康状态、fallback 链、角色路由。
- 测试点：UI contract test。

#### B061 Web Generate Workbench

- 目标：发起 generate、查看当前 job、展示阶段状态。
- 涉及目录：`packages/web/src/features/generate`.
- 依赖：B048,B023。
- 完成定义：
  - 可发起 generate/resume。
  - 不展示噪声式工具日志瀑布。
- 测试点：page action integration test。

#### B062 Web Job 详情页

- 目标：展示时间线、当前页、恢复入口、review/validate 结果。
- 涉及目录：`packages/web/src/features/generate`, `packages/web/src/app`.
- 依赖：B061。
- 完成定义：
  - 刷新后能重订阅事件。
  - 中断态仍能展示恢复点。
- 测试点：job page UI test。

#### B063 Web 版本阅读页

- 目标：实现版本概览、导航树和版本切换。
- 涉及目录：`packages/web/src/features/wiki`.
- 依赖：B045,B023。
- 完成定义：
  - 版本页读取 `wiki.json` 和 `version.json`。
- 测试点：SSR/read model test。

#### B064 Web 页面页与 Markdown Renderer

- 目标：展示页面正文、目录、相关页和页面 utility rail。
- 涉及目录：`packages/web/src/features/wiki`.
- 依赖：B063。
- 完成定义：
  - Markdown、Mermaid、TOC 正常显示。
- 测试点：page renderer test。

#### B065 Source Drawer / Citation Chip

- 目标：点击引用后能打开源码抽屉。
- 涉及目录：`packages/web/src/features/wiki`.
- 依赖：B047,B064。
- 完成定义：
  - 能看到文件路径、行号、片段。
- 测试点：citation interaction test。

#### B066 搜索页（页面/文件/引用）

- 目标：提供阅读增强搜索。
- 涉及目录：`packages/web/src/features/search`.
- 依赖：B063,B065。
- 完成定义：
  - 三种搜索视图都能使用。
- 测试点：search page test。

#### B067 Web 版本切换与最近阅读

- 目标：补齐日常阅读效率能力。
- 涉及目录：`packages/web/src/features/wiki`, `packages/web/src/features/projects`.
- 依赖：B063。
- 完成定义：
  - 最近阅读和版本切换可用。
- 测试点：UI state test。

#### B068 Web E2E 基线

- 目标：覆盖项目页、版本页、页面页、job 页主路径。
- 涉及目录：Web 测试。
- 依赖：B061-B065。
- 完成定义：
  - 四类核心页面都可稳定访问。
- 测试点：Playwright/Cypress E2E。

### Epic M6: CLI 主链路

#### B070 CLI `generate` 主链路

- 目标：终端发起生成并持续展示状态。
- 涉及目录：`packages/cli/src/commands`, `packages/cli/src/components`.
- 依赖：B048,B015。
- 完成定义：
  - 可发起 generate/resume。
  - 状态栏持续更新。
- 测试点：CLI integration test。

#### B071 CLI 持续状态栏与阶段时间线

- 目标：统一 mode、当前页、阶段、review/validate 结果展示。
- 涉及目录：`packages/cli/src/components`.
- 依赖：B070。
- 完成定义：
  - 满足 [design.md](/Users/jyxc-dz-0100318/open_source/repo_read/docs/design.md#L920) 输出约束。
- 测试点：CLI output snapshot。

#### B072 CLI `browse`

- 目标：启动本地阅读器并能定位项目/版本/页面。
- 涉及目录：`packages/cli/src/commands`.
- 依赖：B063,B004。
- 完成定义：
  - 能打印本地地址并带定位参数。
- 测试点：command smoke test。

#### B073 CLI `doctor`

- 目标：诊断 Provider、清单、恢复点和目录健康。
- 涉及目录：`packages/cli/src/commands`, `packages/core/src/config`, `packages/core/src/storage`.
- 依赖：B014,B024。
- 完成定义：
  - 不可用模型、损坏清单、异常恢复点可识别。
- 测试点：doctor integration test。

#### B074 CLI `ask` 壳层

- 目标：提供问答入口和引用摘要显示。
- 涉及目录：`packages/cli/src/commands`.
- 依赖：B080。
- 完成定义：
  - 能对指定页或当前页发起 ask。
- 测试点：CLI ask smoke test。

#### B075 CLI `research` 壳层

- 目标：提供研究入口。
- 涉及目录：`packages/cli/src/commands`.
- 依赖：B090。
- 完成定义：
  - 能流式显示研究计划和结论。
- 测试点：CLI research smoke test。

#### B076 CLI 输出 contract 测试

- 目标：固定长命令输出结构，防止漂移。
- 涉及目录：CLI 测试目录。
- 依赖：B070-B075。
- 完成定义：
  - `generate/jobs/ask/research` 输出结构可回归。
- 测试点：snapshot/contract。

#### B077 CLI/Web 共享事件消费适配

- 目标：保证两端消费同一事件语义。
- 涉及目录：`packages/cli`, `packages/web`, `packages/core/src/events`.
- 依赖：B048,B023。
- 完成定义：
  - 相同 job 在两端展示出的阶段语义一致。
- 测试点：event replay comparison。

#### B078 CLI 主链路 E2E

- 目标：把 CLI 端主链路跑通。
- 涉及目录：CLI E2E 测试。
- 依赖：B070-B077。
- 完成定义：
  - 至少跑通一次 `init -> generate -> interrupt -> resume -> browse`。
- 测试点：CLI e2e。

### Epic M7: Ask 问答

#### B080 AskService 路由判定

- 目标：实现 `page-first / page-plus-retrieval / research` 路由判定。
- 涉及目录：`packages/core/src/ask`.
- 依赖：B063,B032。
- 完成定义：
  - 简单问题不直接升级 research。
- 测试点：route decision test。

#### B081 Ask 会话内存态管理

- 目标：实现 `AskSession`、会话摘要和最近证据缓存。
- 涉及目录：`packages/core/src/ask`.
- 依赖：B080。
- 完成定义：
  - 进程存活时可继续同一 session。
  - 进程退出后会话失效。
- 测试点：session lifecycle test。

#### B082 页面优先检索与补证链路

- 目标：先页面、再实时本地检索。
- 涉及目录：`packages/core/src/ask`, `packages/core/src/retrieval`.
- 依赖：B080,B032。
- 完成定义：
  - 文档足够时不做高成本检索。
- 测试点：page-first integration test。

#### B083 Chat Dock 流式事件

- 目标：Web 页面级 Chat Dock 可流式问答。
- 涉及目录：`packages/web/src/features/chat`.
- 依赖：B081,B023。
- 完成定义：
  - 锚定当前页面 slug。
  - 显示引用摘要。
- 测试点：chat dock integration test。

#### B084 CLI `ask` 流式输出与引用摘要

- 目标：终端问答体验可用。
- 涉及目录：`packages/cli/src/commands`, `packages/cli/src/components`.
- 依赖：B081。
- 完成定义：
  - 能显示流式回答和引用列表。
- 测试点：CLI output snapshot。

#### B085 Ask Contract / Integration 测试

- 目标：把 ask 从服务到 UI 都串起来测。
- 涉及目录：ask/web/cli 测试。
- 依赖：B082-B084。
- 完成定义：
  - Web Chat Dock 和 CLI ask 都能输出可追溯引用。
- 测试点：integration suite。

#### B086 “先页面后检索”回归用例

- 目标：把核心心智固化成回归测试。
- 涉及目录：ask 测试目录。
- 依赖：B085。
- 完成定义：
  - 页面已覆盖问题不会触发高成本检索。
- 测试点：behavior regression test。

### Epic M8: Research 研究

#### B090 ResearchService 计划生成

- 目标：实现研究计划和子问题骨架。
- 涉及目录：`packages/core/src/research`.
- 依赖：B032,B080。
- 完成定义：
  - 可生成 2-5 个子问题。
- 测试点：research planning test。

#### B091 研究子问题拆分与局部归并

- 目标：支持研究中的局部补证和汇总。
- 涉及目录：`packages/core/src/research`, `packages/core/src/agents`.
- 依赖：B090,B042。
- 完成定义：
  - 子问题可独立取证后回收。
- 测试点：research worker test。

#### B092 研究结论落盘到 `research/`

- 目标：把研究产物写入版本目录，便于回看。
- 涉及目录：`packages/core/src/research`, `packages/core/src/storage`.
- 依赖：B020,B090。
- 完成定义：
  - 研究计划、进度、结论都可读取。
- 测试点：research storage test。

#### B093 Web Research 工作区

- 目标：提供研究计划、进度和结论阅读界面。
- 涉及目录：`packages/web/src/features/research`.
- 依赖：B092,B023。
- 完成定义：
  - 可看到研究计划、阶段性发现、最终结论。
- 测试点：UI integration test。

#### B094 CLI `research` 流式呈现

- 目标：终端研究体验可用。
- 涉及目录：`packages/cli/src/commands`, `packages/cli/src/components`.
- 依赖：B092。
- 完成定义：
  - 可显示计划、子问题进度、结论与引用。
- 测试点：CLI output snapshot。

#### B095 Research 集成测试

- 目标：验证研究链路稳定可用。
- 涉及目录：research 测试目录。
- 依赖：B090-B094。
- 完成定义：
  - 至少一个跨模块问题能正确路由到 research。
- 测试点：integration suite。

#### B096 研究与问答边界回归

- 目标：固定 ask/research 的边界。
- 涉及目录：ask/research 测试目录。
- 依赖：B095。
- 完成定义：
  - 简单问题不误入 research。
  - 复杂问题能升级 research。
- 测试点：routing regression test。

### Epic M9: 集成验证与发布准备

#### B100 Fixture 仓库建设

- 目标：补齐 `mini-ts-app/go-service/python-cli/monorepo-mixed/large-config-heavy-repo`。
- 涉及目录：测试 fixtures。
- 依赖：B002。
- 完成定义：
  - 五类 fixture 可被测试直接复用。
- 测试点：fixture loading smoke test。

#### B101 E2E 主链路

- 目标：覆盖 `init -> generate -> interrupt -> resume -> browse -> ask`。
- 涉及目录：全局 E2E。
- 依赖：B015,B070,B072,B074,B085。
- 完成定义：
  - 这是 V1 发布前必须通过的基线。
- 测试点：主链路 E2E。

#### B102 样例仓库人工验收记录模板

- 目标：把人工验收标准固化成 checklist 模板。
- 涉及目录：`docs/` 或测试 supporting docs。
- 依赖：B100。
- 完成定义：
  - 与 [prd.md](/Users/jyxc-dz-0100318/open_source/repo_read/docs/prd.md#L552) 对齐。
- 测试点：人工验收流程演练。

#### B103 文档回链与入口整理

- 目标：把主文档、设计思路、逆向分析和 backlog 的入口整理好。
- 涉及目录：`docs/`.
- 依赖：当前文档体系。
- 完成定义：
  - 新同学能快速知道先看什么。
- 测试点：文档入口人工检查。

#### B104 发布前 checklist 固化

- 目标：把发布阻断项转成可执行清单。
- 涉及目录：`docs/`, CI, scripts（如需要）。
- 依赖：B101,B102。
- 完成定义：
  - 发布前检查路径稳定。
- 测试点：release dry run。

---

## 7. 建议的首批 issue 集合

如果现在要开始真正开工，建议第一批只开 10 个 issue：

1. B001 Monorepo 基础脚手架
2. B002 共享 TS / lint / test 基础设施
3. B003 `packages/core` 基础目录与公共类型
4. B010 用户可编辑配置 schema
5. B011 密钥引用与 Provider 凭证存储
6. B012 Provider 抽象与能力探测模型
7. B013 角色路由与 fallback 解析
8. B020 `.reporead` 目录协议与 StorageAdapter
9. B022 统一事件类型与 `events.ndjson`
10. B030 Repo Profiler

原因很简单：

- 这 10 个任务是后面所有 runtime 的地基。
- 现在去做 ask/research/web 细节，返工概率会很高。
- 只有先把配置、存储、事件和 profiler 稳住，后面 catalog/page 才不会变成反复返工。

---

## 8. 不要这样拆

以下拆法看起来快，实际会把项目带偏：

1. 先做一个华丽的 Web 页面，再回头补 core。
2. 先做 ask/research，再回头补 catalog/page。
3. 先做多模型复杂编排，再回头补主链路。
4. 把页面生成、审稿、校验、发布混成一个“大任务”。
5. 把 Web 和 CLI 各自实现一套独立 runtime。

---

## 9. 完成这份 backlog 后的下一步

这份文档完成后，最合理的下一步不是继续补设计，而是做两件事：

1. 按本文把 issue/backlog 真正开出来。
2. 从 B001 开始进入实现，边做边对照 [design-rationale.md](/Users/jyxc-dz-0100318/open_source/repo_read/docs/design-rationale.md) 防止偏航。

如果需要进一步细化，可以再补一份：

- “按周排期版”
- 或者“按 package 拆分版”

但不是当前阻断项。
