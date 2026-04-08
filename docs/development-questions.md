# RepoRead 开发前待确认问题清单

> 版本：v1.0
> 更新时间：2026-04-08
> 文档定位：在进入编码实施前，梳理设计文档与参考项目之间的落地缺口，形成需要确认的开发决策和产品需求问题
> 关联文档：
> - [产品需求文档（PRD）](./prd.md)
> - [工程整体设计文档](./design.md)
> - [核心 Agent 架构设计文档](./agent-architecture.md)
> - [开发任务拆解文档](./development-backlog.md)
> - [完整 Issue 清单](./development-issues.md)

---

## 1. 文档目标

设计文档已收敛到可执行状态，但从"设计文档"到"第一行代码"之间仍有一批决策需要确认。这份清单不重复讨论方向问题，只聚焦"开工前必须拍板或明确的落地细节"。

以下问题已于 2026-04-08 完成第一轮拍板，统一答案见文末“## 14. 已拍板答案”。

问题按以下分类组织：

- **DQ**: Development Question（开发决策）
- **PQ**: Product Question（产品需求确认）

每个问题标注：

- **优先级**：`Blocking`（不拍板无法编码）、`Important`（影响多个模块）、`Nice-to-have`（可延后）
- **影响范围**：涉及的 Backlog 任务 ID

---

## 2. 工程基础设施

### DQ-001 | 运行时选择：Node.js 还是 Bun？

**优先级**：Blocking
**影响范围**：B001, B002, 全局

设计文档指定 TypeScript，但未明确运行时。参考项目的选择分化明显：

| 项目 | 运行时 |
| --- | --- |
| claude-code | Bun |
| codex | Rust (native) |
| opencode | Bun |
| oh-my-openagent | Bun |
| deepwiki-open | Python + Node.js (Next.js) |

**需要确认**：
1. `packages/core` 和 `packages/cli` 使用 Bun 还是 Node.js？
2. 如果选 Bun，是否接受 Bun 的 API 兼容性风险（部分 Node.js 原生模块可能不完全兼容）？
3. `packages/web` 使用 Next.js，Next.js 官方推荐 Node.js 运行时 —— 是否接受 core/cli 用 Bun 而 web 用 Node.js 的混合方案？

**建议**：core/cli 使用 Bun（启动速度快、TypeScript 原生支持、与参考项目一致），web 使用 Node.js（Next.js 官方支持）。monorepo 工具用 pnpm workspace（设计文档已提及 `pnpm-workspace.yaml`）。

---

### DQ-002 | 包管理器确认

**优先级**：Blocking
**影响范围**：B001

设计文档目录结构中出现 `pnpm-workspace.yaml`，暗示使用 pnpm。

**需要确认**：
1. 确认使用 pnpm 作为 monorepo 包管理器？
2. 如果选 Bun 运行时，是否改用 `bun workspace`（Bun 原生 workspace 支持）替代 pnpm？
3. 是否引入 Turborepo 做构建编排（参考 opencode 的做法）？

---

### DQ-003 | CLI 框架选择

**优先级**：Blocking
**影响范围**：B004, B015, B070-B078

设计文档提到 "Ink 或等价 TUI 组件库"。参考项目的选择：

| 项目 | CLI 框架 |
| --- | --- |
| claude-code | Commander.js + React/Ink |
| codex | Ratatui (Rust) |
| opencode | Solid.js + OpenTUI (custom) |
| oh-my-openagent | Commander.js |

**需要确认**：
1. CLI 命令解析用 Commander.js 还是其他（如 yargs、citty）？
2. TUI 渲染用 Ink（React-based）还是其他方案？
3. 如果用 Ink，`generate` 长任务的进度展示（阶段时间线、页面进度）是否需要交互式 TUI，还是简单的 log 输出即可满足 V1？

**建议**：Commander.js + Ink，与 claude-code 保持一致，生态成熟。V1 的 `generate` 用 Ink 实现阶段时间线组件。

---

### DQ-004 | LLM SDK 选择

**优先级**：Blocking
**影响范围**：B012, B014, 全局

设计文档定义了 Provider 抽象和能力探测，但未指定底层 LLM 调用层。参考项目的选择：

| 项目 | LLM SDK |
| --- | --- |
| claude-code | @anthropic-ai/sdk (直接) |
| codex | 自研 Rust client |
| opencode | Vercel AI SDK (@ai-sdk) |
| oh-my-openagent | @opencode-ai/sdk |
| deepwiki-open | AdalFlow (Python) |

**需要确认**：
1. 是否使用 Vercel AI SDK（`@ai-sdk/provider`）作为统一 Provider 层？优势：20+ provider 开箱即用、streaming/tool-call 标准化。
2. 还是自行封装轻量 Provider 接口，只对接 OpenAI-compatible API + Anthropic API？
3. 设计文档中的 `ModelCapability` 能力探测是否需要运行时真实调用（probe request），还是靠静态配置表？

**建议**：使用 Vercel AI SDK。它已经抽象了 streaming、tool calls、structured output 等能力，与设计文档的 Provider 抽象高度吻合。能力探测可结合静态表 + 运行时探针。

---

### DQ-005 | Schema 验证库版本

**优先级**：Important
**影响范围**：B002, B010, 全局

设计文档指定 Zod 做校验。当前 Zod 有两个活跃版本：

- Zod v3（稳定、生态广泛）
- Zod v4（新版、性能更好、API 有破坏性变更）

参考项目中 claude-code 使用 Zod v4，oh-my-openagent 也使用 Zod v4。

**需要确认**：直接使用 Zod v4？

---

### DQ-006 | 测试框架选择

**优先级**：Important
**影响范围**：B002

**需要确认**：
1. 单元测试用 Vitest、Jest 还是 Bun 内置 test runner？
2. 集成测试（涉及 LLM 调用）的策略：mock 还是真实调用？
3. Golden fixture 测试的比对工具：手写还是用 snapshot testing？

**建议**：如果选 Bun 运行时，用 Bun 内置 test（与 oh-my-openagent 一致）。LLM 相关集成测试用录制回放（类似 VCR pattern）避免每次真实调用。

---

## 3. Provider 与模型

### DQ-010 | V1 必须支持的 Provider 清单

**优先级**：Blocking
**影响范围**：B012, B014

设计文档提到"provider-agnostic"，但未列出 V1 必须支持的 Provider。

**需要确认**：V1 至少支持哪些 Provider？

**建议最小集**：
1. **OpenAI**（GPT-4o / GPT-5 系列）—— 最广泛
2. **Anthropic**（Claude Opus / Sonnet）—— 主力模型
3. **OpenAI-compatible**（Ollama、vLLM、LM Studio 等本地模型）—— 满足 `local-only` preset
4. **Google**（Gemini Pro）—— 可选

其他 Provider（Azure、Bedrock、DeepSeek、Qwen 等）是否推迟到 V1.5？

---

### DQ-011 | 模型族 Prompt 调优的粒度

**优先级**：Important
**影响范围**：B014, B033, B041

设计文档定义了 `SystemPromptTuningProfile`（reasoning_style、tool_call_style、citation_style、retry_policy），按模型族维护。

**需要确认**：
1. V1 需要覆盖几个模型族的 prompt 调优？建议最小集：`claude-opus/sonnet`、`gpt-4o/gpt-5`、`generic-openai-compatible`。
2. 模型族识别逻辑：按 model name prefix 匹配，还是需要更复杂的探测？
3. prompt 调优模板是硬编码在代码中，还是作为 JSON/YAML 配置文件管理？

---

### DQ-012 | 能力探测的实现机制

**优先级**：Important
**影响范围**：B012, B014

设计文档要求 `ProviderCenterService` 对每个模型记录 `supportsStreaming`、`supportsToolCalls`、`supportsJsonSchema` 等能力。

**需要确认**：
1. 能力探测是否需要发送真实 probe 请求（例如发一个简单的 tool call 测试）？
2. 还是只依赖静态能力表（按已知模型名匹配）？
3. 如果是真实探测，探测失败的模型是标记为 `unavailable` 还是降级到 `degraded`？
4. 探测结果的缓存过期时间？设计文档提到"缓存到全局目录"，具体 TTL 是多少？

---

### DQ-013 | SecretStore 实现

**优先级**：Important
**影响范围**：B011

设计文档定义两层：优先系统 Keychain，不可用时允许环境变量模式。

**需要确认**：
1. macOS Keychain 访问用哪个库？（如 `keytar`、`node-keychain`、直接调用 `security` CLI）
2. Linux 下是否支持 GNOME Keyring / KWallet，还是 V1 仅 macOS Keychain + 环境变量？
3. Windows 是否在 V1 支持 Credential Manager？
4. "环境变量模式"是指只读 `process.env`，还是需要支持 `.env` 文件？

---

## 4. Agent 实现

### DQ-020 | fork.worker 与 fresh.reviewer 的实现方式

**优先级**：Blocking
**影响范围**：B042, B043

设计文档定义了语义：`Task` 工具创建 `fork.worker`，`Agent` 工具创建 `fresh.reviewer`。但未说明底层实现。

**需要确认**：
1. `fork.worker` 是同进程内的独立 LLM 调用（共享内存上下文），还是独立子进程？
2. `fresh.reviewer` 是独立子进程（完全隔离的 context），还是同进程内的新 conversation session？
3. 参考实现中，claude-code 的 `AgentTool` 支持 worktree 隔离和 `SendMessage` 通信。RepoRead 是否需要类似的进程级隔离？
4. 子任务的超时和资源限制策略？

**建议**：V1 简化实现 —— `fork.worker` 为同进程内独立 LLM conversation（继承 context 快照），`fresh.reviewer` 为同进程内全新 LLM conversation（不继承 context）。不需要子进程隔离。

---

### DQ-021 | Context Window 管理与压缩策略

**优先级**：Important
**影响范围**：B041, B080

设计文档中 `main.author` 持有 `MainAuthorContext`（project_summary、full_book_summary、published_page_summaries、evidence_ledger），但未说明 context window 接近上限时的压缩策略。

**需要确认**：
1. 当 evidence_ledger 和 published_page_summaries 增长到接近 context 上限时，如何压缩？
2. 参考 claude-code 的 snip-based compaction，还是 opencode 的 summarize-old-messages？
3. 是否需要主动 compaction（在达到阈值时触发），还是被动压缩（API 返回 context 超限时才触发）？
4. 压缩后丢失的细节是否影响后续页面生成质量？如何评估这个风险？

---

### DQ-022 | 证据账本（Evidence Ledger）的容量规划

**优先级**：Important
**影响范围**：B041, B047

`evidence_ledger` 按设计会随页面生成持续增长。

**需要确认**：
1. 一个典型仓库（如 deepwiki-open，~50 个源文件）生成 25 页，证据账本预计多大？
2. 账本是否需要分页面维护（每页独立账本），还是全局统一？
3. 已发布页面的证据是否从活跃账本移出到归档？

---

### DQ-023 | 主控 Agent 的 Conversation 重建

**优先级**：Important
**影响范围**：B040, B046

`main.author` 在 `catalog -> page_01 -> page_02 -> ... -> page_25` 的过程中，conversation 会非常长。

**需要确认**：
1. 每生成一个页面后，是否重建 conversation（只注入 MainAuthorContext snapshot），还是持续追加？
2. 如果重建，重建的 context 包含哪些内容？（full_book_summary + 已发布 page summaries + 下一页 plan）
3. 如果持续追加，如何避免 25 页生成过程中 context overflow？
4. `resume` 场景下，conversation 必须重建 —— 重建的输入是什么？只认 `job-state.json` + 已落盘 artifacts？

---

## 5. 工具系统

### DQ-030 | ripgrep 依赖方式

**优先级**：Blocking
**影响范围**：B032

设计文档的实时检索依赖 `rg`（ripgrep）。

**需要确认**：
1. ripgrep 是作为系统依赖要求用户自行安装，还是打包到项目中？
2. 参考 claude-code 的做法：bundled ripgrep binary。RepoRead 是否跟随？
3. 如果 bundle，需要处理多平台（macOS arm64/x64、Linux x64/arm64）二进制分发。
4. 如果要求系统安装，`doctor` 命令需要检测 `rg` 是否可用。

---

### DQ-031 | Bash 白名单的具体范围

**优先级**：Important
**影响范围**：B031, B032

设计文档强调"只读白名单 bash"，但未列出具体白名单。

**需要确认**：
1. 白名单的具体命令列表？建议：`wc`、`sort`、`uniq`、`head`、`tail`、`tree`、`file`、`stat`、`du`、`ls`。
2. 是否允许管道组合（如 `wc -l | sort`）？
3. 是否允许 `cat`（已有 `Read` 工具，是否冗余）？
4. 如何检测和拒绝非白名单命令？正则匹配还是 AST 解析？
5. 禁止的模式：`>`、`>>`、`|`（管道到写入命令）、`rm`、`mv`、`cp`、`chmod`、`curl`、`wget` 等。

---

### DQ-032 | PageRead 与 CitationOpen 的实现

**优先级**：Important
**影响范围**：B032

这两个是 RepoRead 独有的工具（参考项目中不存在）。

**需要确认**：
1. `PageRead` 读取已发布页面 —— 是读 Markdown 原文还是解析后的结构化数据？
2. `PageRead` 是否也读 `meta.json`（包含 summary、coveredFiles 等）？
3. `CitationOpen` 从引用跳转到证据 —— 跳转后返回的是文件片段（带行号范围）、commit diff 还是页面段落？
4. 引用格式设计：`file://path#L10-L20`、`page://slug#section`、`commit://hash`？

---

### DQ-033 | 窗口化文件读取的参数

**优先级**：Nice-to-have
**影响范围**：B032

**需要确认**：
1. 默认读取窗口大小？（claude-code 默认 2000 行）
2. 是否支持按 offset + limit 读取？
3. 大文件（>10000 行）的处理策略？

---

## 6. 存储与落盘

### DQ-040 | 版本原子提升的实现

**优先级**：Important
**影响范围**：B045

设计文档要求"原子方式把 `draft/<version_id>/...` 提升到 `versions/<version_id>/...`"。

**需要确认**：
1. "原子方式"具体是 `fs.rename`（目录重命名，同文件系统上是原子的），还是 copy + delete？
2. 如果 rename 失败（跨文件系统），fallback 策略？
3. 提升过程中断电/崩溃的恢复：是否需要一个 `promoting` 中间状态记录在 `job-state.json`？
4. 已发布版本是否可以被删除或回退？

---

### DQ-041 | events.ndjson 的容量与清理

**优先级**：Nice-to-have
**影响范围**：B022

**需要确认**：
1. 一个 25 页的生成任务，events.ndjson 预计多大？（每页可能 50-200 个事件）
2. 是否需要自动清理或归档旧事件？
3. SSE 重连时，从 ndjson 回放的最大事件数？

---

### DQ-042 | current.json 的并发安全

**优先级**：Nice-to-have
**影响范围**：B020

如果 CLI 和 Web 同时运行（Web 通过 `browse` 命令启动后，CLI 又执行 `generate`），两端都会读写 `current.json`。

**需要确认**：
1. 是否需要文件锁机制？
2. V1 是否简化为"同一时刻只允许一个生成任务"？

---

## 7. Catalog 与页面生成

### DQ-050 | Catalog 输出的页面数量限制

**优先级**：Important
**影响范围**：B033

Zread 固定生成 25 页。RepoRead 的设计文档未限制页面数量。

**需要确认**：
1. V1 是否对页面数量设上限（如 50 页）？
2. 页面数量是否由 `catalog` 阶段的 LLM 自主决定？
3. 不同规模仓库的预期页面数：小仓库（<20 文件）、中仓库（20-200 文件）、大仓库（>200 文件）？

---

### DQ-051 | Catalog Prompt 的设计来源

**优先级**：Important
**影响范围**：B033

Zread 的 catalog prompt 已在 `docs/zread_analysis/prompts/catalog-system.txt` 和 `catalog-user.txt` 中完整提取。

**需要确认**：
1. RepoRead 的 catalog prompt 是否参考 zread 的 catalog prompt 重写？
2. Zread 的 catalog prompt 定义了分析框架（Why/What/Who/How）和 XML 输出结构。RepoRead 是否沿用类似框架？
3. RepoRead 的 catalog 输出是 JSON（`wiki.json`），zread 是 XML —— prompt 中的输出格式指令需要重新设计。
4. 是否需要为不同模型族准备不同的 catalog prompt 变体？

---

### DQ-052 | Page Prompt 的设计来源

**优先级**：Important
**影响范围**：B041

Zread 的 page prompt（page-system.txt + 25 个 page-user.txt）已完整提取。

**需要确认**：
1. RepoRead 的 page prompt 是否参考 zread 的 page prompt 重写？
2. Zread 的 page prompt 定义了作者人设（INTJ 架构师）、写作框架（Diataxis + AIDA）和证据标准。RepoRead 是否采用类似人设和框架？
3. RepoRead 的 page prompt 需要额外注入哪些上下文？（当前页 plan、已发布页面摘要、evidence ledger 摘要）
4. page prompt 中的 Mermaid 图表生成指令如何设计？是强制要求每页包含 Mermaid，还是由模型自主判断？

---

### PQ-053 | 页面的目标语言

**优先级**：Important
**影响范围**：B033, B041

Zread 支持 `--language` 参数（captures 中观察到 `"language": "zh"`），但 RepoRead 设计文档未提及多语言。

**需要确认**：
1. V1 是否支持指定输出语言？（如中文、英文、日文）
2. 如果支持，语言选择在哪个环节指定？（`init` 时配置？`generate` 时参数？）
3. 语言选择是否影响 prompt 模板？（不同语言的 prompt 是否不同）

---

### DQ-054 | 审稿轮次上限

**优先级**：Important
**影响范围**：B043

设计文档中，审稿结论为 `revise` 时，主控需要补证、改稿并重新发起审稿。

**需要确认**：
1. 单页最多允许几轮审稿-修订循环？（如 3 轮）
2. 达到上限后的处理：强制发布（带警告标记）还是放弃该页？
3. 每轮修订是否重新走完整 `retrieve -> draft -> review` 还是只修补？

---

### DQ-055 | Validator 的 Mermaid 校验实现

**优先级**：Nice-to-have
**影响范围**：B044

设计文档要求 validator 校验 Mermaid 图表。

**需要确认**：
1. Mermaid 校验是否需要真正渲染（调用 mermaid-cli / puppeteer）？
2. 还是只做语法级检查（正则匹配 mermaid 代码块的基本结构）？
3. 如果需要渲染校验，这会引入 puppeteer/chromium 依赖，是否在 V1 接受？

**建议**：V1 只做语法级检查（校验 mermaid 代码块是否有合法的 diagram type 声明），不引入 headless browser 依赖。

---

## 8. Web 端

### DQ-060 | Next.js 版本与 App Router 确认

**优先级**：Important
**影响范围**：B004, B060-B068

**需要确认**：
1. 使用 Next.js 15 (latest) 还是 Next.js 14 (LTS)？
2. 确认使用 App Router（非 Pages Router）？
3. 是否使用 Server Components + Server Actions？
4. 样式方案：Tailwind CSS？其他？

---

### DQ-061 | Web 端的 Markdown 渲染管线

**优先级**：Important
**影响范围**：B063

设计文档提到 `remark/rehype` 管线。

**需要确认**：
1. 基础管线：`remark-parse` -> `remark-rehype` -> `rehype-stringify`？
2. Mermaid 渲染：服务端预渲染（mermaid-cli）还是客户端渲染（mermaid.js）？
3. 代码高亮：`rehype-highlight`、`shiki`、还是 `prism`？
4. 引用芯片（citation chip）：是 remark/rehype 插件还是 React 组件后处理？
5. 是否需要支持 GFM（GitHub Flavored Markdown）扩展（表格、任务列表等）？

---

### DQ-062 | Web 端的实时进度展示

**优先级**：Important
**影响范围**：B064

**需要确认**：
1. 生成任务进度通过 SSE 推送 —— 前端用什么接收？（EventSource API、fetch streaming、SWR 等）
2. 页面生成过程中，前端是否实时展示"当前正在写第 N 页"的进度条？
3. 是否需要在前端展示 Agent 的工具调用过程（类似 claude-code 的 tool call 展示）？

---

### DQ-063 | Chat Dock 的会话模型

**优先级**：Nice-to-have
**影响范围**：B082

**需要确认**：
1. Chat Dock 是全局固定面板，还是跟随当前页面上下文？
2. 切换页面时，会话是否自动切换到该页面的上下文？
3. 会话历史是否持久化？持久化到哪里？（`.reporead/projects/<slug>/ask/` ?）

---

## 9. CLI 端

### DQ-070 | CLI 的 generate 交互模式

**优先级**：Important
**影响范围**：B070

**需要确认**：
1. `repo-read generate` 是长时间阻塞式运行（前台持续输出），还是后台任务模式（submit + poll）？
2. 如果阻塞式，Ctrl+C 时的行为：立即中断还是优雅保存当前页到 draft？
3. 是否支持 `--resume` 从上次中断处继续？
4. 是否支持 `--dry-run` 只输出 catalog 不生成页面？

---

### DQ-071 | CLI 的 browse 命令

**优先级**：Nice-to-have
**影响范围**：B076

设计文档提到 `browse` 启动本地 Web 服务。

**需要确认**：
1. `browse` 是启动完整 Next.js dev server，还是一个轻量静态文件服务？
2. 如果是 Next.js，启动时间可能较长（5-10s），是否可接受？
3. 是否支持 `--port` 参数？
4. Zread 的做法是内建 Web server（`--host`、`--port`、自动端口检测）—— RepoRead 是否跟随？

---

### DQ-072 | CLI 的 ask 交互模式

**优先级**：Important
**影响范围**：B080

**需要确认**：
1. `repo-read ask` 是单次问答（输入问题 -> 输出答案 -> 退出），还是多轮交互式 REPL？
2. 如果是 REPL，是否需要像 claude-code 那样的 TUI 输入框？
3. 流式输出时的渲染：纯文本、Markdown 还是 Ink 富文本？
4. 引用展示：inline 引用芯片还是答案末尾的引用列表？

---

## 10. 产品需求确认

### PQ-080 | 项目名称与 CLI 命令名

**优先级**：Blocking
**影响范围**：全局

**需要确认**：
1. npm 包名：`repo-read`、`reporead`、`@reporead/core` / `@reporead/cli` / `@reporead/web`？
2. CLI 命令名：`repo-read`、`reporead`、`rr`？
3. `.reporead/` 目录名已在设计文档中确定，是否同步确认？

---

### PQ-081 | V1 的最小可用场景

**优先级**：Blocking
**影响范围**：M4, M5, M6

**需要确认**：V1 的最小可交付版本应该跑通哪条路径？

建议两个候选：

**方案 A（最小）**：`init -> generate(catalog + pages) -> browse`
- 能配置 Provider
- 能生成 wiki（catalog + 全部页面）
- 能在本地浏览生成结果
- 不含 ask / research

**方案 B（完整 V1）**：`init -> generate -> browse -> ask -> research`
- 包含所有四种 mode

V1 先交付方案 A 还是方案 B？

---

### PQ-082 | 页面质量标准

**优先级**：Important
**影响范围**：B041, B050

**需要确认**：
1. 页面的最低质量标准是什么？（例如：每页至少 N 个引用、每页至少包含 1 个 Mermaid 图、每页至少覆盖 N 个文件）
2. Golden fixture 的评判标准：人工审查还是自动化指标？
3. 是否需要与 zread 的输出做 A/B 对比评估？

---

### PQ-083 | 目标仓库的规模限制

**优先级**：Important
**影响范围**：B030

**需要确认**：
1. V1 支持的仓库规模上限？（文件数、代码行数、目录深度）
2. 超大仓库（如 Linux kernel、Chromium）是否明确声明不支持？
3. monorepo 风格仓库（如 packages/* 下多个子项目）是否支持？如果支持，是否按子项目独立生成？

---

### PQ-084 | 错误提示与用户沟通

**优先级**：Nice-to-have
**影响范围**：B040, B046

**需要确认**：
1. 生成过程中 LLM 返回质量不佳（如空内容、乱码、不遵循格式）时，是否向用户展示原因？
2. 审稿失败且 fallback 耗尽时，用户看到什么？是否提供可执行的建议（如"请更换 fresh.reviewer 模型"）？
3. 错误信息是中文还是英文？是否跟随系统 locale？

---

## 11. 开发流程

### DQ-090 | 开发分支策略

**优先级**：Nice-to-have
**影响范围**：全局

**需要确认**：
1. 主分支是 `main`，feature 分支命名规范？（如 `feature/M0-scaffold`、`feat/B001-monorepo`）
2. 每个 Backlog 任务一个 PR 还是按里程碑合并？
3. 是否需要 CI/CD（GitHub Actions）？V1 覆盖哪些检查？（lint、type-check、unit test、build）

---

### DQ-091 | 代码风格与架构约定

**优先级**：Important
**影响范围**：B002, 全局

**需要确认**：
1. 文件命名规范：kebab-case（如 `job-state.ts`）还是 camelCase？
2. 导出风格：barrel exports（index.ts）还是直接导入？
3. 错误处理范式：throw + try/catch、Result type、还是 Effect（参考 opencode）？
4. 是否使用 path alias（如 `@core/`、`@cli/`）？
5. 代码注释语言：中文还是英文？

---

## 12. 待后续确认的非阻塞问题

以下问题不阻塞开发启动，可在实施过程中逐步明确：

| ID | 问题 | 建议确认时间 |
| --- | --- | --- |
| DQ-100 | research 模式的最大迭代轮次 | M8 开始前 |
| DQ-101 | 版本对比（version diff）的展示方式 | V1.5 规划时 |
| DQ-102 | 页面导出格式（PDF、EPUB、单文件 Markdown） | V1.5 规划时 |
| DQ-103 | 多仓库项目支持 | V2 规划时 |
| DQ-104 | 插件/扩展系统 | V2 规划时 |
| DQ-105 | 国际化（i18n）框架选型 | 确认 PQ-053 后 |
| DQ-106 | 性能基线（每页生成时间、token 消耗量） | M4 集成测试时 |

---

## 13. 问题优先级总览

### Blocking（不拍板无法开工）

| ID | 问题 | 涉及 |
| --- | --- | --- |
| DQ-001 | 运行时选择 Node.js / Bun | 全局 |
| DQ-002 | 包管理器确认 | B001 |
| DQ-003 | CLI 框架选择 | B004 |
| DQ-004 | LLM SDK 选择 | B012 |
| DQ-010 | V1 必须支持的 Provider 清单 | B012 |
| DQ-020 | fork.worker / fresh.reviewer 实现方式 | B042, B043 |
| DQ-030 | ripgrep 依赖方式 | B032 |
| PQ-080 | 项目名称与 CLI 命令名 | 全局 |
| PQ-081 | V1 最小可用场景 | M4-M6 |

### Important（影响多个模块）

| ID | 问题 | 涉及 |
| --- | --- | --- |
| DQ-005 | Zod 版本 | B002 |
| DQ-006 | 测试框架 | B002 |
| DQ-011 | 模型族 Prompt 调优粒度 | B014 |
| DQ-012 | 能力探测实现 | B012 |
| DQ-013 | SecretStore 实现 | B011 |
| DQ-021 | Context Window 压缩策略 | B041 |
| DQ-022 | 证据账本容量 | B047 |
| DQ-023 | Conversation 重建 | B040 |
| DQ-031 | Bash 白名单 | B031 |
| DQ-032 | PageRead / CitationOpen 实现 | B032 |
| DQ-050 | 页面数量限制 | B033 |
| DQ-051 | Catalog Prompt 设计来源 | B033 |
| DQ-052 | Page Prompt 设计来源 | B041 |
| PQ-053 | 页面目标语言 | B033 |
| DQ-054 | 审稿轮次上限 | B043 |
| DQ-060 | Next.js 版本 | B004 |
| DQ-061 | Markdown 渲染管线 | B063 |
| DQ-062 | 实时进度展示 | B064 |
| DQ-070 | generate 交互模式 | B070 |
| DQ-072 | ask 交互模式 | B080 |
| DQ-091 | 代码风格约定 | B002 |
| PQ-082 | 页面质量标准 | B050 |
| PQ-083 | 仓库规模限制 | B030 |

---

## 14. 已拍板答案

### 14.1 工程基础设施

#### DQ-001 | 运行时选择：Node.js 还是 Bun？

**结论**：

1. `packages/core`、`packages/cli`、`packages/web` 统一使用 **Node.js 22 LTS**。
2. V1 不引入 Bun。
3. 不采用 core/cli 用 Bun、web 用 Node.js 的混合方案。

**原因**：

- 当前目标是质量优先、稳定优先，不为了启动速度引入额外兼容性变量。
- Next.js 官方路径与 Node.js 更稳定。
- LLM SDK、Keychain、CLI、SSE、文件系统与测试工具在 Node.js 生态更稳。

**落地动作**：

- 在 `B001/B002` 中锁定 Node.js 22 LTS。
- `doctor` 增加 Node 版本检查。

#### DQ-002 | 包管理器确认

**结论**：

1. 使用 **pnpm workspace**。
2. 不改用 Bun workspace。
3. V1 不引入 Turborepo，先用 pnpm 原生 workspace + scripts。

**原因**：

- 当前三包结构不复杂，先减少额外编排层。
- pnpm 的 monorepo 体验和生态已经足够支撑 V1。

#### DQ-003 | CLI 框架选择

**结论**：

1. 命令解析使用 **Commander.js**。
2. TUI 渲染使用 **Ink**。
3. `generate`、`jobs`、`ask` 等长命令走 Ink 状态栏和时间线；不退化成只有 log 的模式。

**原因**：

- 与 claude-code 的心智接近。
- 生态成熟，React 组件化有利于后续扩展。

#### DQ-004 | LLM SDK 选择

**结论**：

1. V1 使用 **Vercel AI SDK + RepoRead 自己的薄封装**。
2. Provider 适配统一收敛到 `providers/` 层，不直接把 SDK 细节散到业务代码里。
3. 能力探测采用“静态能力表 + 运行时轻量探针”的混合模式。

**原因**：

- 便于统一 streaming、tool calls、structured output。
- 兼顾 provider-agnostic 和后续自定义控制。

#### DQ-005 | Schema 验证库版本

**结论**：直接使用 **Zod v4**。

#### DQ-006 | 测试框架选择

**结论**：

1. 单元与集成测试使用 **Vitest**。
2. LLM 相关集成测试默认走 **录制回放 / fixture replay**，不默认真实调用。
3. Golden fixture 用 snapshot + 自定义 normalizer。

**原因**：

- 在 Node.js runtime 下，Vitest 足够快且 TS 体验好。
- 真实 LLM 调用只保留为手工或受控 smoke，不作为常规 CI 依赖。

### 14.2 Provider 与模型

#### DQ-010 | V1 必须支持的 Provider 清单

**结论**：

V1 必须支持：

1. **OpenAI**
2. **Anthropic**
3. **OpenAI-compatible**（覆盖 Ollama、vLLM、LM Studio 等本地模型）

V1 可选支持：

4. **Google Gemini**，但不是首发阻断项。

其他 Provider 推迟到 V1.5 以后。

#### DQ-011 | 模型族 Prompt 调优的粒度

**结论**：

1. V1 最少覆盖 3 个模型族：
   - `anthropic-claude`
   - `openai-gpt`
   - `generic-openai-compatible`
2. 如果 Gemini 在 V1 落地，再补 `google-gemini`。
3. 模型族识别用 **provider + model name prefix** 即可，不做复杂探测。
4. prompt tuning 模板以 **代码模块** 维护，不先做 JSON/YAML 配置化。

#### DQ-012 | 能力探测的实现机制

**结论**：

1. 先走静态能力表，再做轻量 runtime probe。
2. Probe 至少验证：认证、streaming、tool call、JSON schema。
3. 认证失败或模型不存在标记为 `unavailable`。
4. 暂时能力不足或探测异常标记为 `degraded`。
5. 缓存 TTL 设为 **24 小时**，配置变化或连续失败时强制重测。

#### DQ-013 | SecretStore 实现

**结论**：

1. V1 优先使用 **keytar** 统一封装系统密钥存储。
2. macOS 用 Keychain，Windows 用 Credential Manager，Linux 在 keytar 可用时跟随系统后端。
3. 若系统密钥存储不可用，fallback 到 **只读 `process.env`**。
4. V1 不把 `.env` 文件作为官方 SecretStore 机制。

### 14.3 Agent 实现

#### DQ-020 | fork.worker 与 fresh.reviewer 的实现方式

**结论**：

1. `fork.worker` 为 **同进程内独立 LLM conversation**，继承主控的上下文快照。
2. `fresh.reviewer` 为 **同进程内全新 LLM conversation**，不继承作者上下文。
3. V1 不做子进程隔离，不做 worktree 隔离。
4. 资源策略：
   - `fork.worker`：短超时、窄上下文、禁止递归委派
   - `fresh.reviewer`：中等超时、完整 briefing、结构化输出必须成功

#### DQ-021 | Context Window 管理与压缩策略

**结论**：

1. **页面边界强制重建 conversation**，不做 25 页连续累加。
2. `main.author` 在每页开始前重建输入，只注入：
   - `project_summary`
   - `full_book_summary`
   - 已发布页面摘要
   - 当前页计划
   - 最近证据摘要
3. ask 会话采用主动压缩，在接近 context 上限前触发 summary compaction。
4. 不采用“继续无限追加直到溢出”的策略。

#### DQ-022 | 证据账本（Evidence Ledger）的容量规划

**结论**：

1. 账本采用 **页级账本 + 全局摘要账本** 两层结构。
2. 当前活跃页保留完整证据。
3. 已发布页只保留页面摘要和高价值引用索引，细节归档到页面 meta / citation ledger。
4. 全局账本不长期保存大量原始片段，只保存能支持后续页面边界判断和复用的摘要。

#### DQ-023 | 主控 Agent 的 Conversation 重建

**结论**：

1. `catalog` 单独一个 conversation。
2. 每个 `page` 都重建一个新的 `main.author` conversation。
3. `resume` 必须重建，输入只认：
   - `job-state.json`
   - 已落盘 `draft` / `review` / `validation` / `wiki.json`
   - 页面摘要与全书摘要
4. 不依赖旧的原始 conversation transcript 作为恢复源。

### 14.4 工具系统

#### DQ-030 | ripgrep 依赖方式

**结论**：

1. V1 优先使用 **bundled ripgrep binary**。
2. 首选集成现成二进制分发包，例如 `@vscode/ripgrep` 一类方案。
3. 系统安装的 `rg` 作为 fallback。
4. `doctor` 必须检查 bundled / system `rg` 是否可用。

#### DQ-031 | Bash 白名单的具体范围

**结论**：

1. Bash 白名单最小集：
   - `wc`
   - `sort`
   - `uniq`
   - `head`
   - `tail`
   - `tree`
   - `file`
   - `stat`
   - `du`
   - `ls`
2. 允许只读命令之间的简单管道。
3. 默认不允许 `cat`，优先使用 `Read`。
4. 命令校验使用 **解析后的 token/AST 规则**，不用纯正则硬判。
5. 明确禁止：
   - `>`
   - `>>`
   - 写入型重定向
   - `rm/mv/cp/chmod/chown`
   - `curl/wget`
   - 子 shell 和环境变量注入式逃逸

#### DQ-032 | PageRead 与 CitationOpen 的实现

**结论**：

1. `PageRead` 返回 **结构化结果**，不是只给 Markdown 原文。
2. `PageRead` 同时读取：
   - 页面 Markdown
   - `meta.json`
   - 页面摘要、covered files、citation index
3. `CitationOpen` 返回统一的 `CitationRecord`：
   - `file`：文件片段 + 行号范围
   - `page`：页面段落或 section 摘要
   - `commit`：commit 元数据或 diff 摘要
4. 内部引用使用结构化对象，不把 URI 字符串当唯一数据源。

#### DQ-033 | 窗口化文件读取的参数

**结论**：

1. 默认窗口大小：**300 行**。
2. 支持 `offset + limit`。
3. 单次硬上限：**500 行**。
4. 对超大文件先要求 `grep/find` 定位，再允许读窗口，不允许整文件直读。

### 14.5 存储与落盘

#### DQ-040 | 版本原子提升的实现

**结论**：

1. 同文件系统内优先使用 **`fs.rename`**。
2. 若遇到跨文件系统 `EXDEV`，fallback 到“复制到目标文件系统临时目录，再 rename 到最终位置”。
3. 不新增 `promoting` 状态，继续复用现有 `publishing` 阶段。
4. 已发布版本在 V1 视为只读，不提供回退和删除 UI。

#### DQ-041 | events.ndjson 的容量与清理

**结论**：

1. 默认不在 V1 自动清理当前 job 的事件。
2. 项目级保留策略：
   - 保留最近 20 个 job 的事件文件
   - 或保留最近 30 天
3. SSE 重连时只回放最近必要事件窗口，不默认全量回放整个历史。

#### DQ-042 | current.json 的并发安全

**结论**：

1. V1 约束为 **单项目同一时刻只允许一个生成任务**。
2. 使用项目级生成锁，避免并发发布。
3. `current.json` 只在发布成功时由单写者更新。

### 14.6 Catalog 与页面生成

#### DQ-050 | Catalog 输出的页面数量限制

**结论**：

1. V1 设 **硬上限 50 页**。
2. Catalog 可自主决定页数，但 validator/repair 必须限制在上限内。
3. 经验目标：
   - 小仓库：6-12 页
   - 中仓库：12-25 页
   - 大仓库：25-40 页

#### DQ-051 | Catalog Prompt 的设计来源

**结论**：

1. RepoRead 的 catalog prompt 参考 zread catalog prompt 重写。
2. 保留类似的分析框架，但输出目标改成 **结构化 JSON / schema 对齐的 `wiki.json` 草案**。
3. 模型族差异只在系统内建 prompt tuning 层处理，不做多套语义完全不同的 catalog prompt。

#### DQ-052 | Page Prompt 的设计来源

**结论**：

1. RepoRead 的 page prompt 参考 zread page prompt 重写。
2. 保留“证据驱动、页面边界明确、结构化写作”的主思想。
3. 额外注入：
   - 当前页 plan
   - 已发布页面摘要
   - 全书摘要
   - 当前页证据摘要
4. Mermaid 不是每页强制，**在能显著提升理解且证据充分时优先生成**。

#### PQ-053 | 页面的目标语言

**结论**：

1. V1 支持输出语言配置。
2. 项目有默认语言，`generate` 可做单次覆盖。
3. V1 官方保证 **中文 / 英文**，其他语言 best-effort。
4. prompt 使用统一模板 + 语言变量，不维护完全独立的多语言模板体系。

#### DQ-054 | 审稿轮次上限

**结论**：

1. 单页最大 **3 轮** `review -> revise` 循环。
2. 达到上限后不强制发布，页面进入失败/待人工处理状态。
3. 修订走“定向补证 + 定向改稿 + 再审稿”，不回退到整书重跑。

#### DQ-055 | Validator 的 Mermaid 校验实现

**结论**：

1. V1 只做 **语法级 Mermaid 校验**。
2. 不引入 puppeteer/chromium 做真实渲染校验。
3. 后续如果 Mermaid 问题频繁，再考虑 V1.5 加强。

### 14.7 Web 端

#### DQ-060 | Next.js 版本与 App Router 确认

**结论**：

1. 使用 **Next.js 15** 当前稳定版本。
2. 确认使用 **App Router**。
3. 默认使用 **Server Components**。
4. `Server Actions` 仅在适合的简单表单场景使用，不作为核心前提。
5. 样式方案使用 **Tailwind CSS**。

#### DQ-061 | Web 端的 Markdown 渲染管线

**结论**：

1. 管线采用 unified/remark/rehype。
2. 启用 **GFM**。
3. 代码高亮使用 **Shiki**。
4. Mermaid 采用 **客户端渲染**。
5. citation chip 通过 remark/rehype 插件转成 React 可渲染节点。

#### DQ-062 | Web 端的实时进度展示

**结论**：

1. 前端通过 **EventSource API** 接收 SSE。
2. 实时展示当前阶段、当前页和整体进度。
3. V1 不展示 agent 的底层工具调用过程，只展示高价值任务状态。

#### DQ-063 | Chat Dock 的会话模型

**结论**：

1. Chat Dock 是 **页面级上下文面板**。
2. 切换页面时，默认切到新页面上下文。
3. ask 会话不做长期持久化，仍保持进程内内存态。

### 14.8 CLI 端

#### DQ-070 | CLI 的 generate 交互模式

**结论**：

1. `repo-read generate` 默认是 **前台阻塞式长任务**。
2. Ctrl+C 触发 **优雅中断**，先写安全点再退出。
3. 支持 `--resume`。
4. V1 支持 `--catalog-only`，不做泛化 `--dry-run`。

#### DQ-071 | CLI 的 browse 命令

**结论**：

1. `browse` 启动本地 Web 阅读器，不走静态文件服务。
2. 使用已构建的本地 Web 服务形态，不依赖 `next dev`。
3. 支持 `--port`。
4. 支持自动端口探测，整体交互向 zread 靠拢。

#### DQ-072 | CLI 的 ask 交互模式

**结论**：

1. V1 的 CLI `ask` 默认 **单次问答**。
2. Web Chat Dock 承担多轮主体验。
3. CLI 输出以流式 Markdown/纯文本为主，不做复杂输入框式 TUI。
4. 引用默认放在答案末尾的引用列表里。

### 14.9 产品需求确认

#### PQ-080 | 项目名称与 CLI 命令名

**结论**：

1. 包作用域采用：
   - `@reporead/core`
   - `@reporead/cli`
   - `@reporead/web`
2. CLI 命令名保持当前文档约定：**`repo-read`**
3. 隐藏目录名保持：**`.reporead/`**

#### PQ-081 | V1 的最小可用场景

**结论**：

V1 发布阻断链路定为：

```text
init -> generate -> interrupt -> resume -> browse -> ask
```

research 在 V1 可以有基础能力，但 **不是首发阻断项**。

#### PQ-082 | 页面质量标准

**结论**：

1. 不设“一刀切”的每页固定引用数或 Mermaid 数。
2. V1 最低质量标准是：
   - 页面不越界
   - 每个实质性 section 都有来源支撑
   - 不存在 blocker 级 factual risk
   - 页面能回链到真实证据
3. Golden fixture 用“自动结构检查 + 人工抽样评审”联合判断。
4. 与 zread 的 A/B 对比可以做，但不作为唯一放行条件。

#### PQ-083 | 目标仓库的规模限制

**结论**：

1. V1 目标是 **小到中型仓库**。
2. 官方支持上限先定为：
   - 忽略后不超过 5000 个文本/代码文件
   - 或不超过约 100 万行文本
3. Linux kernel / Chromium 这类超大仓库明确不作为 V1 支持目标。
4. monorepo 在 V1 支持，但以 **单项目根路径/单子项目范围** 生成，不做全超级仓多子项目统一大书。

#### PQ-084 | 错误提示与用户沟通

**结论**：

1. 必须向用户展示失败原因与下一步建议。
2. 当审稿失败且 fallback 耗尽时，要明确提示例如“请更换 `fresh.reviewer` 模型”。
3. 错误信息默认跟随产品语言，V1 默认中文。

### 14.10 开发流程

#### DQ-090 | 开发分支策略

**结论**：

1. 主分支为 `main`。
2. 建议命名：
   - `feat/B001-monorepo-scaffold`
   - `feat/B044-validator-chain`
3. 优先一 issue 一 PR。
4. CI 最小集：
   - lint
   - type-check
   - unit test
   - build

#### DQ-091 | 代码风格与架构约定

**结论**：

1. 文件名统一 **kebab-case**。
2. `index.ts` 只在包边界或清晰模块边界使用，不全局滥用 barrel exports。
3. 错误处理采用 **throw + typed AppError + 顶层统一映射**，V1 不引入 Effect。
4. 使用 path alias，但优先包边界 alias，不做过度复杂的深层别名。
5. 代码注释与代码内文案使用英文，产品界面和文档可用中文。
