# Zread Prompt Index

以下文件由 `../zread-proxy/captures/*.json` 中首轮模型请求直接提取，保留原始 prompt 文本。

这份索引解决的是“哪些 prompt 被发送过”。如果你关心的是“这些 prompt 是怎么按阶段渲染出来的”，请结合阅读 [`../prompt-rendering-rules.md`](../prompt-rendering-rules.md)。

## 先说明一个容易误解的点

- 这里不只有 system prompt。
- `catalog-user.txt` 和 `page-xx-user.txt` 也是从真实请求中抽出的 user prompt。
- 但这些 user prompt 是“已经渲染完成的实例”，不是上游的未渲染模板源码。

## Prompt 家族

| 家族 | 文件数量 | 说明 |
| --- | --- | --- |
| Catalog System | 1 | 目录生成阶段共用的固定 system prompt。 |
| Catalog User | 1 | 目录生成阶段的首轮 user prompt 实例。 |
| Page System | 1 | 页面生成阶段共用的固定 system prompt。 |
| Page User | 25 | 25 个页面各自的首轮 user prompt 实例。 |

| 类型 | 捕获 ID | 文件 | 页面标题 |
| --- | --- | --- | --- |
| Catalog System | 1 | [catalog-system.txt](./catalog-system.txt) | Catalog |
| Catalog User | 1 | [catalog-user.txt](./catalog-user.txt) | Catalog |
| Page System | 22 | [page-system.txt](./page-system.txt) | All page generations |
| Page User | 22 | [page-01-user.txt](./page-01-user.txt) | 项目概述：DeepWiki-Open 是什么与为什么存在 |
| Page User | 37 | [page-02-user.txt](./page-02-user.txt) | 快速上手：安装、配置与运行 |
| Page User | 49 | [page-03-user.txt](./page-03-user.txt) | Docker 容器化部署与生产环境配置 |
| Page User | 65 | [page-04-user.txt](./page-04-user.txt) | 系统整体架构：前后端协作与数据流 |
| Page User | 87 | [page-05-user.txt](./page-05-user.txt) | 数据流水线：仓库克隆、文档解析与向量化处理 |
| Page User | 103 | [page-06-user.txt](./page-06-user.txt) | RAG 检索增强生成：嵌入检索与对话记忆管理 |
| Page User | 128 | [page-07-user.txt](./page-07-user.txt) | WebSocket 实时通信：流式问答与 DeepResearch 多轮研究 |
| Page User | 147 | [page-08-user.txt](./page-08-user.txt) | 提示词工程：系统提示模板与多语言适配策略 |
| Page User | 176 | [page-09-user.txt](./page-09-user.txt) | Next.js 应用结构：路由系统与页面渲染流程 |
| Page User | 193 | [page-10-user.txt](./page-10-user.txt) | Wiki 生成页面：从仓库输入到交互式知识库展示 |
| Page User | 219 | [page-11-user.txt](./page-11-user.txt) | React 组件体系：UI 组件职责与交互设计 |
| Page User | 243 | [page-12-user.txt](./page-12-user.txt) | WebSocket 客户端：实时流式通信与消息处理 |
| Page User | 263 | [page-13-user.txt](./page-13-user.txt) | 模型提供商架构：统一抽象与可插拔客户端设计 |
| Page User | 281 | [page-14-user.txt](./page-14-user.txt) | 嵌入模型配置：OpenAI、Google、Ollama 与 Bedrock 向量化策略 |
| Page User | 301 | [page-15-user.txt](./page-15-user.txt) | 生成模型配置：generator.json 与多提供商参数管理 |
| Page User | 322 | [page-16-user.txt](./page-16-user.txt) | 配置系统详解：JSON 配置文件与环境变量管理 |
| Page User | 341 | [page-17-user.txt](./page-17-user.txt) | 文件过滤机制：仓库分析中的包含与排除规则 |
| Page User | 374 | [page-18-user.txt](./page-18-user.txt) | 国际化与多语言支持：i18n 架构与语言配置 |
| Page User | 400 | [page-19-user.txt](./page-19-user.txt) | REST API 端点总览：Wiki 缓存、模型配置与导出 |
| Page User | 412 | [page-20-user.txt](./page-20-user.txt) | WebSocket 聊天 API：请求格式、流式响应与错误处理 |
| Page User | 439 | [page-21-user.txt](./page-21-user.txt) | 自定义 LLM 客户端：如何接入新的模型提供商 |
| Page User | 461 | [page-22-user.txt](./page-22-user.txt) | DeepResearch 深度研究：多轮迭代分析的工作原理 |
| Page User | 486 | [page-23-user.txt](./page-23-user.txt) | 私有仓库支持：GitHub、GitLab 与 Bitbucket 的认证流程 |
| Page User | 524 | [page-24-user.txt](./page-24-user.txt) | Wiki 缓存机制：本地持久化与跨会话复用 |
| Page User | 559 | [page-25-user.txt](./page-25-user.txt) | Ollama 本地模型集成：离线部署与自定义模型 |
