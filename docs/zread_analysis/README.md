# Zread 逆向分析

本目录用于沉淀对 Zread CLI 的抓包、产出物、提示词和 Web 能力的逆向结果，便于后续继续拆 Agent、Tool、前端交互和生成链路。

## 分析范围

- 抓包来源：`../zread-proxy/captures/*.json`
- 产出物来源：`../deepwiki-open/.zread`
- 官方页面：`https://zread.ai/cli`
- 本地安装：`npm install -g zread_cli` 后的全局包与 `zread --help`

## 目录说明

- [`prompts/prompt-index.md`](./prompts/prompt-index.md)：全部首轮模型 prompt 的索引。
- [`prompt-rendering-rules.md`](./prompt-rendering-rules.md)：按阶段拆解 Zread 的 prompt 模板、运行时变量和 user prompt 渲染规则。
- [`prompts/catalog-system.txt`](./prompts/catalog-system.txt)：目录生成的 system prompt。
- [`prompts/catalog-user.txt`](./prompts/catalog-user.txt)：目录生成的 user prompt。
- [`prompts/page-system.txt`](./prompts/page-system.txt)：页面生成共用的 system prompt。
- `prompts/page-01-user.txt` 到 `prompts/page-25-user.txt`：25 个页面生成任务各自的完整 user prompt 实例。
- [`artifacts.md`](./artifacts.md)：`.zread` 目录结构、`wiki.json`、Markdown 页面格式与落盘行为。
- [`tool-agent-loop.md`](./tool-agent-loop.md)：Tool 注册表、调用闭环、会话拆分与统计。
- [`web-capabilities.md`](./web-capabilities.md)：官方 CLI 页面、本地帮助输出与产出物共同体现的 Web 能力。

## 关键结论

- 截至 2026-04-07，本地抓包里可确认的模型会话一共 26 个：1 个目录生成会话，25 个页面生成会话。
- Zread 的核心 Agent 工具只有 3 个：`get_dir_structure`、`view_file_in_detail`、`run_bash`。其中 `view_file_in_detail` 是绝对主力。
- 本地安装的 `zread_cli@0.2.2` 只是 Node shim，真正执行的是平台二进制 `@zread/cli-darwin-arm64`。
- 模型请求发往 `/api/coding/paas/v4/chat/completions`，抓包中使用的模型是 `glm-5.1`；同时存在到 `/api/v1/event/cli/report` 的埋点上报。
- `prompts/` 目录里保存的是首轮请求中已经渲染完成的 prompt 实例，不是源码级模板；模板层规则已单独整理到 [`prompt-rendering-rules.md`](./prompt-rendering-rules.md)。
- 页面生成 prompt 明确要求最终输出包裹在 `<blog></blog>` 中，但 `.zread/wiki/versions/.../*.md` 落盘结果里没有该包裹，说明流式结果与最终落盘之间存在一次清洗或后处理。
- 官方页面与本地帮助都表明 Zread 不只是“生成文档”，还包含本地 Web 预览、版本切换、草稿恢复和登录配置等完整 CLI 工作流。

## 建议阅读顺序

1. 先看 [`prompts/prompt-index.md`](./prompts/prompt-index.md)，确认 prompt 家族、捕获 ID 和页面覆盖范围。
2. 再看 [`prompt-rendering-rules.md`](./prompt-rendering-rules.md)，理解 catalog/page 两阶段的模板骨架、变量来源和渲染规则。
3. 然后看 [`tool-agent-loop.md`](./tool-agent-loop.md)，理解它如何循环读代码、发起工具调用和收敛结果。
4. 接着看 [`artifacts.md`](./artifacts.md)，理解最终 Wiki 是怎么存储和组织的。
5. 最后看 [`web-capabilities.md`](./web-capabilities.md)，把 CLI、预览和 Web 呈现能力拼成完整产品视角。
