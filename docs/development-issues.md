# RepoRead 完整 Issue 清单

> 版本：v1.0
> 更新时间：2026-04-08
> 文档定位：把全量实施计划整理成可直接创建 issue 的执行清单
> 关联文档：
> - [开发任务拆解文档](./development-backlog.md)
> - [产品需求文档（PRD）](./prd.md)
> - [工程整体设计文档](./design.md)
> - [核心 Agent 架构设计文档](./agent-architecture.md)
> - [设计思路说明](./design-rationale.md)

---

## 1. 使用说明

这份文档是 [development-backlog.md](./development-backlog.md) 的 issue 化版本。

推荐用法：

- 直接按本文逐条创建 GitHub issue。
- `ID` 直接作为 issue 前缀。
- `依赖` 可映射成 blocked by / depends on。
- `完成定义` 可直接放到 issue checklist。

字段解释：

- `优先级`：`P0` 为主链路阻断项，`P1` 为 V1 强相关项，`P2` 为后续增强项。
- `交付物`：该 issue 应主要落地的模块、页面或产物。
- `完成定义`：满足即可关闭 issue。

---

## 2. 第一批建议立即创建的 Issue

如果现在就开始开工，建议先建这 16 个：

- `B001` `B002` `B003` `B004`
- `B010` `B011` `B012` `B013` `B014` `B015`
- `B020` `B021` `B022` `B023` `B024`
- `B030` `B031` `B032`

原因：

- 这是配置、Provider、存储、事件、实时本地检索的地基。
- 没有这层基础，后续 `catalog/page/review/validator/publish/resume` 很容易返工。

---

## 3. Issue 清单

### M0 工程脚手架与公共基础

| ID | 优先级 | 标题 | 交付物 | 依赖 | 完成定义 |
| --- | --- | --- | --- | --- | --- |
| B001 | P0 | Monorepo 基础脚手架 | `packages/core`、`packages/web`、`packages/cli`、workspace 配置 | 无 | workspace 可安装依赖，三包可识别，根命令可跑 |
| B002 | P0 | 共享 TS / lint / test 基础设施 | 根 `tsconfig`、eslint、测试配置、路径别名 | B001 | 三包共用规则，类型检查与空测试通过 |
| B003 | P0 | `packages/core` 基础目录与公共类型 | `config/providers/project/storage/events/tools/...` 目录与 `types/` 出口 | B001,B002 | 目录结构与设计文档一致，公共类型可被引用 |
| B004 | P0 | `packages/web` / `packages/cli` 最小壳层 | Web 空壳首页、CLI 命令入口 | B001,B002 | Web 可启动，CLI 可显示帮助，可引用 core |

### M1 配置、密钥与 Provider 路由

| ID | 优先级 | 标题 | 交付物 | 依赖 | 完成定义 |
| --- | --- | --- | --- | --- | --- |
| B010 | P0 | 用户可编辑配置 schema | `UserEditableConfig`、三角色 schema | B003 | 只支持三角色，字段仅 `model/fallback_models`，非法配置拒绝 |
| B011 | P0 | 密钥引用与 Provider 凭证存储 | `secretRef`、掩码视图、凭证读取 | B010 | 凭证不混入角色配置，Web/CLI 只读到掩码 |
| B012 | P0 | Provider 抽象与能力探测模型 | Provider 接口、`ModelCapability` | B010 | 支持 streaming/tool/json schema/long context 能力描述 |
| B013 | P0 | 角色路由与 fallback 解析 | `ResolvedConfig`、角色路由 | B012 | 三角色路由与 fallback 顺序稳定，预设只影响内部预算 |
| B014 | P0 | Provider Center Service | 配置解析、能力探测、路由选择 | B011,B012,B013 | 能输出角色路由摘要，能解释 fallback 原因 |
| B015 | P0 | CLI `init` / `providers` 初版 | `repo-read init/providers` | B014,B004 | 能绑定项目，能查看/测试/保存角色映射 |
| B016 | P1 | Web `/settings/providers` 初版 | Provider 配置中心页面 | B014,B004 | 可展示凭证引用、角色模型、fallback 与能力状态 |

### M2 存储、事件与项目模型

| ID | 优先级 | 标题 | 交付物 | 依赖 | 完成定义 |
| --- | --- | --- | --- | --- | --- |
| B020 | P0 | `.reporead` 目录协议与 StorageAdapter | storage 目录协议、读写 API | B003 | 项目/版本/job/draft/review/validation/research 目录可创建和读写 |
| B021 | P0 | 项目模型与 `project.json` | 项目注册、默认版本指针 | B020 | 项目列表、repoRoot、默认版本可追踪 |
| B022 | P0 | 统一事件类型与 `events.ndjson` | `AppEvent`、事件落盘与回放 | B020 | job/ask/research 事件统一，支持顺序回放 |
| B023 | P0 | SSE 适配层 | Web 事件流 adapter | B022 | Web 可订阅 job/ask/research 事件，重连语义清晰 |
| B024 | P0 | `job-state.json` 读写与恢复准源 | 任务状态快照与恢复读取 | B020 | 任一阶段切换先写 `job-state.json`，恢复只认它 |
| B025 | P1 | CLI `jobs` / `versions` 初版 | `repo-read jobs/versions` | B021,B024 | 可查看最新 job、版本列表与默认版本 |
| B026 | P1 | Web `/projects` / 项目页基础读取 | 项目列表页、项目概览页 | B021,B023 | 可显示 repo 路径、当前版本、最近 job |

### M3 Repo Profiler、Catalog 与轻量清单

| ID | 优先级 | 标题 | 交付物 | 依赖 | 完成定义 |
| --- | --- | --- | --- | --- | --- |
| B030 | P0 | Repo Profiler | 仓库扫描、入口发现、语言/框架识别 | B021 | 可生成 `RepoProfile`，输出可被 catalog 消费 |
| B031 | P0 | Ignore/路径策略与受控只读边界 | 路径防护、只读白名单、ignore 合并 | B030 | 路径越界被拒绝，非白名单命令不可执行 |
| B032 | P0 | 实时本地检索工具封装 | `Read/Grep/Find/Git/Bash/PageRead/CitationOpen` | B030,B031,B020 | 检索顺序、窗口读取和结果标准化可用 |
| B033 | P0 | Catalog Planner | `catalog` mode 主控执行与输出解析 | B030,B032,B014 | 可输出章节树、页面顺序、level/section/group |
| B034 | P0 | 轻量清单与 `wiki.json` 草案落盘 | `wiki.json` 草案、页面顺序与依赖 | B033,B020 | 轻量清单可读，顺序与依赖可恢复 |
| B035 | P1 | Catalog 校验与失败重试 | catalog 合法性检查与 repair/retry | B033,B034 | 非法 catalog 不推进 page，重试策略清晰 |
| B036 | P1 | Catalog Golden Fixtures | catalog golden 基线 | B033 | 至少 3 类仓库有稳定 golden 输出 |

### M4 生成、审稿、校验、发布、恢复

| ID | 优先级 | 标题 | 交付物 | 依赖 | 完成定义 |
| --- | --- | --- | --- | --- | --- |
| B040 | P0 | GenerationJob 状态机 | 生成状态机与阶段切换 | B024,B034 | `queued -> ... -> completed`、`interrupted`、`failed` 语义完整 |
| B041 | P0 | Page Draft Runtime | 严格串行的 page 起草流程 | B040,B032,B014 | 一次只起草一页，草稿与 meta 正确落盘 |
| B042 | P0 | `fork.worker` 委派协议 | 页内局部补证协议 | B041 | 只接受窄 directive，结构化返回 findings/citations/open_questions |
| B043 | P0 | `fresh.reviewer` 协议与结果落盘 | 独立审稿、`review/*.review.json` | B041,B014 | fresh session 审稿，输出 blocker/risk/missing evidence/scope violation |
| B044 | P0 | `validator` 链 | 结构/引用/链接/Mermaid 校验 | B041,B043 | 未通过校验的页面不可发布，报告可被读取 |
| B045 | P0 | Publisher 与版本原子提升 | 版本提升、current 指针更新 | B044,B020 | draft 安全提升为 version，不污染半成品版本 |
| B046 | P0 | Interrupt / Resume 流程 | interrupt、resume、安全点恢复 | B040,B044,B045 | 中断保留草稿/review/validate，`resume` 从安全点继续 |
| B047 | P1 | 页面元数据与引用账本 | 页面 meta、citation ledger、源码回链 | B041,B044 | 引用可回链到文件/页面/commit，页面附加信息可被 UI 读取 |
| B048 | P0 | Generation 事件发射与回放 | job 事件映射与回放 | B040,B022 | CLI/Web 消费同一事件语义，关键事件带阶段和当前页 slug |
| B049 | P0 | Page/Review/Validation 集成测试 | 主链路组合测试 | B041-B048 | 至少一个完整 fixture 跑通 page/review/validation/publish/resume |
| B050 | P1 | 主链路 Golden 与样例仓库校验 | 页面结构/引用格式/事件序列基线 | B049 | 主链路核心输出可稳定回归 |

### M5 Web 基础工作台

| ID | 优先级 | 标题 | 交付物 | 依赖 | 完成定义 |
| --- | --- | --- | --- | --- | --- |
| B060 | P1 | Web Provider Center | Provider 中心完善版 | B016 | 可查看健康状态、fallback 链、角色路由 |
| B061 | P1 | Web Generate Workbench | generate/resume 工作台 | B048,B023 | 可发起任务并看到阶段状态，不展示噪声式工具日志瀑布 |
| B062 | P1 | Web Job 详情页 | 阶段时间线、当前页、恢复入口 | B061 | 刷新后能重订阅事件，中断后仍能看到恢复点 |
| B063 | P1 | Web 版本阅读页 | 版本概览、导航树、版本切换 | B045,B023 | 可正确读取 `wiki.json` 和 `version.json` |
| B064 | P1 | Web 页面页与 Markdown Renderer | 正文阅读器、Mermaid、TOC | B063 | 页面正文稳定可读 |
| B065 | P1 | Source Drawer / Citation Chip | 引用抽屉与代码片段定位 | B047,B064 | 点击引用能看到文件路径、行号和片段 |
| B066 | P2 | 搜索页（页面/文件/引用） | 阅读增强搜索 | B063,B065 | 页面/文件/引用三种搜索视图都可用 |
| B067 | P2 | Web 版本切换与最近阅读 | recent reads、version switcher | B063 | 用户可快速回到最近阅读页面 |
| B068 | P1 | Web E2E 基线 | 项目页/版本页/页面页/job 页 E2E | B061-B065 | 四类核心页面都可稳定访问 |

### M6 CLI 主链路

| ID | 优先级 | 标题 | 交付物 | 依赖 | 完成定义 |
| --- | --- | --- | --- | --- | --- |
| B070 | P0 | CLI `generate` 主链路 | `repo-read generate` / `resume` | B048,B015 | 可以发起生成并看到持续状态 |
| B071 | P1 | CLI 持续状态栏与阶段时间线 | 长任务统一输出 | B070 | 满足设计文档的状态栏/阶段时间线输出约束 |
| B072 | P1 | CLI `browse` | 本地阅读器启动与定位参数 | B063,B004 | 能打印本地地址并带 project/version/page 定位 |
| B073 | P1 | CLI `doctor` | Provider/清单/恢复点诊断 | B014,B024 | 能识别不可用模型、损坏清单、异常恢复点 |
| B074 | P1 | CLI `ask` 壳层 | 终端问答入口 | B080 | 能发起 ask 并接收结果 |
| B075 | P2 | CLI `research` 壳层 | 终端研究入口 | B090 | 能展示研究计划、进度和结论 |
| B076 | P1 | CLI 输出 contract 测试 | `generate/jobs/ask/research` 输出回归 | B070-B075 | 长命令输出结构稳定 |
| B077 | P1 | CLI/Web 共享事件消费适配 | 两端事件消费语义对齐 | B048,B023 | 同一 job 在两端看到的阶段语义一致 |
| B078 | P0 | CLI 主链路 E2E | `init -> generate -> interrupt -> resume -> browse` | B070-B077 | CLI 主链路至少跑通一次 |

### M7 Ask 问答

| ID | 优先级 | 标题 | 交付物 | 依赖 | 完成定义 |
| --- | --- | --- | --- | --- | --- |
| B080 | P0 | AskService 路由判定 | `page-first / page-plus-retrieval / research` 路由 | B063,B032 | 简单问题不误入 research |
| B081 | P0 | Ask 会话内存态管理 | `AskSession`、summary、recent evidence | B080 | 进程存活时可继续同一 session，进程退出后失效 |
| B082 | P0 | 页面优先检索与补证链路 | ask 核心检索链路 | B080,B032 | 文档足够时不做高成本检索 |
| B083 | P1 | Chat Dock 流式事件 | 页面级 Chat Dock | B081,B023 | 可围绕当前页稳定问答并显示引用摘要 |
| B084 | P1 | CLI `ask` 流式输出与引用摘要 | 终端 ask 结果呈现 | B081 | CLI ask 能显示回答和引用 |
| B085 | P0 | Ask Contract / Integration 测试 | ask 全链路测试 | B082-B084 | Web 和 CLI 都能输出可追溯引用 |
| B086 | P1 | “先页面后检索”回归用例 | ask 关键心智回归 | B085 | 页面已覆盖问题不会触发高成本检索 |

### M8 Research 研究

| ID | 优先级 | 标题 | 交付物 | 依赖 | 完成定义 |
| --- | --- | --- | --- | --- | --- |
| B090 | P1 | ResearchService 计划生成 | 研究计划、2-5 个子问题 | B032,B080 | 可生成研究计划和子问题列表 |
| B091 | P1 | 研究子问题拆分与局部归并 | 子问题委派和局部结果回收 | B090,B042 | 子问题能独立取证后回收 |
| B092 | P1 | 研究结论落盘到 `research/` | plan/progress/conclusion 落盘 | B020,B090 | 研究结果可回看 |
| B093 | P2 | Web Research 工作区 | 研究计划/进度/结论 UI | B092,B023 | 用户可查看研究计划、阶段性发现和结论 |
| B094 | P2 | CLI `research` 流式呈现 | 终端研究展示 | B092 | 终端可完整展示研究过程与结果 |
| B095 | P1 | Research 集成测试 | research 全链路测试 | B090-B094 | 至少一个跨模块问题能正确进入 research |
| B096 | P2 | 研究与问答边界回归 | ask/research 路由回归 | B095 | 简单问题不误入 research，复杂问题可升级 research |

### M9 集成验证与发布准备

| ID | 优先级 | 标题 | 交付物 | 依赖 | 完成定义 |
| --- | --- | --- | --- | --- | --- |
| B100 | P0 | Fixture 仓库建设 | 五类 fixture 仓库 | B002 | `mini-ts-app/go-service/python-cli/monorepo-mixed/large-config-heavy-repo` 可被测试复用 |
| B101 | P0 | E2E 主链路 | `init -> generate -> interrupt -> resume -> browse -> ask` | B015,B070,B072,B074,B085 | V1 发布基线主链路 E2E 通过 |
| B102 | P1 | 样例仓库人工验收记录模板 | 验收模板与记录字段 | B100 | 与 PRD 验收标准对齐，可实际演练 |
| B103 | P2 | 文档回链与入口整理 | 文档互链、阅读顺序、入口页 | 当前文档体系 | 新同学能快速知道先看什么 |
| B104 | P1 | 发布前 checklist 固化 | 发布阻断项清单 | B101,B102 | 发布前检查路径稳定 |

---

## 4. 建议的建单顺序

### 第一批：地基

- B001-B004
- B010-B015
- B020-B024
- B030-B032

### 第二批：主链路

- B033-B050
- B061-B065
- B070-B073

### 第三批：增强能力

- B016,B025,B026,B060,B066-B068
- B074-B096
- B100-B104

---

## 5. 说明

这份 issue 清单已经是“完整拆分”的执行视图，但它仍然遵守当前设计边界：

- 不把 P2 增强项当成 V1 发布阻断项。
- 不把 ask/research 提前成首发前置。
- 不引入新的角色或新的系统方向。

下一步如果继续往下走，就不再是写设计文档，而是：

1. 直接按本文创建 issue。
2. 给 issue 指派 owner、估时和目标里程碑。
