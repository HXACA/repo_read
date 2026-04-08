# Zread Tool 与 Agent Loop

本文聚焦抓包中可确认的 Agent 运行机制，不讨论页面内容质量本身。

## 运行时画像

从 `../zread-proxy/captures/*.json` 可以直接确认：

| 项目 | 观察值 |
| --- | --- |
| 模型请求地址 | `/api/coding/paas/v4/chat/completions` |
| 埋点上报地址 | `/api/v1/event/cli/report` |
| User-Agent | `zread_cli/0.2.2` |
| 模型 | `glm-5.1` |
| 安装渠道 | npm |
| 本地包形态 | `zread_cli@0.2.2` Node shim + 平台二进制 optional dependency |

本地安装包也验证了这一点：

- `zread_cli/package.json` 只声明了 `bin/zread.js` 和一组 `@zread/cli-<platform>` optional dependencies。
- `bin/zread.js` 只是根据 `process.platform` 和 `process.arch` 选择平台包，再用 `spawnSync` 调起真正的二进制。

## Tool 注册表

当前抓包里，提供给模型的工具恒定只有 3 个：

| Tool | 参数 | 作用 | 约束 |
| --- | --- | --- | --- |
| `get_dir_structure` | `dir_path`, `max_depth` | 读取目录树 | 自动过滤 `.gitignore` 与常见依赖目录 |
| `view_file_in_detail` | `file_path`, `start_line`, `end_line`, `show_line_numbers` | 读取文件内容 | 默认最多读取 200 行 |
| `run_bash` | `command` | 在仓库根目录执行只读 shell 查询 | 明确禁止写文件、删文件、联网下载和危险命令 |

这套工具设计非常保守，体现出两个明显倾向：

- 优先做本地静态阅读，而不是运行项目。
- 优先做可验证的“基于行号的证据收集”，而不是开放式命令执行。

## Agent Loop 的真实形态

抓包中的单次页面生成并不是“一问一答”，而是典型的工具增强循环：

1. CLI 先发起首轮请求，消息只有 `system + user` 两条。
2. 模型返回 `reasoning_content`，同时给出一个或多个 `tool_calls`。
3. CLI 在本地执行这些工具，并把每个结果封装成独立的 `tool` message。
4. CLI 把 `assistant(tool_calls)` 和多个 `tool` message 一起带回下一轮请求。
5. 模型继续读结果、追加新的工具调用，直到最后一轮 `finish_reason=stop`。

在抓包中，这个结构是可直接看到的：

- `assistant` message 含 `reasoning_content`。
- 同一个 `assistant` message 里可以同时发多个并行工具调用。
- 下一轮请求里会出现多个 `tool` role 消息，每个都带 `tool_call_id`。

这说明 Zread 的 Agent Loop 已经具备“并行读文件 -> 汇总 -> 再追问”的基本 Agent 行为，而不是串行的单工具执行器。

## 会话拆分

把“消息长度为 2 的请求”视为会话起点后，可以确认整次生成包含 26 个模型会话：

- 1 个 Catalog 会话
- 25 个页面会话

各会话的请求跨度如下：

```text
start_id  end_id  request_count  title
1         20      14             CATALOG
22        35      9              项目概述：DeepWiki-Open 是什么与为什么存在
37        48      8              快速上手：安装、配置与运行
49        63      10             Docker 容器化部署与生产环境配置
65        86      13             系统整体架构：前后端协作与数据流
87        102     10             数据流水线：仓库克隆、文档解析与向量化处理
103       126     12             RAG 检索增强生成：嵌入检索与对话记忆管理
128       146     13             WebSocket 实时通信：流式问答与 DeepResearch 多轮研究
147       174     17             提示词工程：系统提示模板与多语言适配策略
176       192     11             Next.js 应用结构：路由系统与页面渲染流程
193       218     14             Wiki 生成页面：从仓库输入到交互式知识库展示
219       242     14             React 组件体系：UI 组件职责与交互设计
243       261     12             WebSocket 客户端：实时流式通信与消息处理
263       279     11             模型提供商架构：统一抽象与可插拔客户端设计
281       300     12             嵌入模型配置：OpenAI、Google、Ollama 与 Bedrock 向量化策略
301       320     13             生成模型配置：generator.json 与多提供商参数管理
322       339     12             配置系统详解：JSON 配置文件与环境变量管理
341       372     22             文件过滤机制：仓库分析中的包含与排除规则
374       399     17             国际化与多语言支持：i18n 架构与语言配置
400       411     8              REST API 端点总览：Wiki 缓存、模型配置与导出
412       437     18             WebSocket 聊天 API：请求格式、流式响应与错误处理
439       460     13             自定义 LLM 客户端：如何接入新的模型提供商
461       484     17             DeepResearch 深度研究：多轮迭代分析的工作原理
486       522     22             私有仓库支持：GitHub、GitLab 与 Bitbucket 的认证流程
524       558     23             Wiki 缓存机制：本地持久化与跨会话复用
559       581     13             Ollama 本地模型集成：离线部署与自定义模型
```

可以看到，复杂主题页会显著增加循环轮数，说明 Zread 并不是固定步数摘要，而是按“信息是否充分”动态扩展调查。

## 工具调用统计

对全部响应里的工具名和结束原因做聚合后，可以得到一组很清晰的分布：

| 统计项 | 数值 |
| --- | --- |
| `view_file_in_detail` | 606 |
| `run_bash` | 80 |
| `get_dir_structure` | 30 |
| `finish_reason=tool_calls` | 332 |
| `finish_reason=stop` | 26 |

这说明：

- Zread 几乎是一个“读文件优先”的代码考古 Agent。
- `run_bash` 只是补充性的目录检索和模式扫描工具。
- `get_dir_structure` 主要用于建立初始结构认知，而不是持续遍历。
- 每个会话几乎都经历了多轮工具调用后才停止。

## Catalog 与 Page 两类 Agent 的差异

虽然抓包里只看到一个统一模型端点，但从 prompt 和行为上，实际上是两类任务模式：

### Catalog 阶段

- system prompt 角色是“expert software engineer and technical writer”。
- 目标是先深读仓库，再产出 `<section>/<topic>/<group>` 风格的目录树。
- 重点是覆盖面、分层结构和读者视角。

### Page 阶段

- system prompt 角色切换为 “INTJ technical documentation architect”。
- 每一页都带当前页面标题、读者等级、完整目录导航和内容边界。
- 输出要求更严格，强调 Sources、Mermaid、表格、交叉引用和 `<blog>` 包裹。

这意味着 Zread 的“Agent 架构”虽然没有显式多 agent 进程，但在 prompt 层面已经被拆成了：

- 目录规划器
- 页面撰写器

## 真实行为特征

从多份抓包综合看，Zread 有这些稳定特征：

- 会先形成假设，再定向读取关键文件，而不是把目录全量扫完。
- 单轮可以并行读取多个文件，常见是 README、配置、入口文件一起读。
- 复杂页会持续追踪更多文件与更多轮次，直到证据足够。
- 最终生成前会保留 `reasoning_content`，说明内部使用的是“可推理 + 可工具调用”的流式模型接口。
- 页面生成的最终流式输出含 `<blog>` 包裹协议，但落盘前会被剥离。

## 逆向结论

如果要复刻 Zread 的 Agent Loop，最核心的不是“一个更聪明的 prompt”，而是这四件事：

1. 把任务切成 Catalog 规划和逐页写作两个阶段。
2. 给模型极小而稳定的只读工具集。
3. 允许多轮、并行、证据驱动的工具调用。
4. 在模型输出协议和最终落盘格式之间做一次清洗转换。
