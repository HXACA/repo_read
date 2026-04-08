# Zread 产出物与存储结构

本文只分析 `../deepwiki-open/.zread` 中已经落盘的 Zread 产出物，不分析 prompt 和工具链路本身。

## 已确认的目录结构

当前样本仓库中实际存在的目录结构如下：

```text
.zread/
└── wiki/
    ├── current
    └── versions/
        └── 2026-04-06-123521/
            ├── wiki.json
            ├── 1-...md
            ├── 2-...md
            └── 25-...md
```

可以确认的事实：

- `versions/2026-04-06-123521/` 下有 26 个文件，其中 25 个是 Markdown 页面，1 个是 `wiki.json`。
- `wiki.json` 里的 `pages` 数组长度为 25，与 25 个 Markdown 页面一一对应。
- `wiki/current` 文件内容是 `versions/2026-04-06-151009`，但该目录当前并不存在。

这意味着当前样本至少出现了一个“当前指针”和“实际可读版本”不一致的情况。更合理的解释是：后续又发生过一次生成或切换，但该版本没有完整落盘，或者清理过程没有同步更新 `current`。

## `wiki.json` 的作用

`wiki.json` 不是正文，而是 Wiki 导航与元数据清单。当前样本包含以下关键字段：

- `id`：版本 ID，例如 `2026-04-06-123521`。
- `generated_at`：UTC 生成时间。
- `language`：文档语言，这里是 `zh`。
- `pages[]`：页面数组，每个页面至少包含 `slug`、`title`、`file`、`section`、`level`，部分页面还有 `group`。

这说明 Zread 的最终 Web/CLI 阅读界面不是直接扫描目录，而是优先依赖 `wiki.json` 构建左侧导航、章节分组和页面跳转。

## 单页 Markdown 的稳定格式

从 `1-xiang-mu-gai-shu-...md` 等页面可以确认，最终落盘的页面遵循一套很稳定的 Markdown 约束：

- 正文是纯 Markdown，不带外层 JSON 或 XML 元数据。
- 每个段落后都带 `Sources:` 引用，引用格式为相对路径加行号区间。
- 页面大量使用 `##` 二级标题组织内容。
- 页面包含 Mermaid 代码块。
- 页面包含表格。
- 页面内部会引用其他 Wiki 页面，用于推荐阅读路径。

这说明 Zread 的页面目标并不是简单文本摘要，而是“可导航、可验证、可视化”的工程文档页面。

## `<blog></blog>` 包裹与落盘差异

抓包里的页面 user prompt 明确要求：

- 最终完整文档必须包在 `<blog></blog>` 中。
- 流式响应尾部也能观察到 `</blog` 和 `>` 这类拆分 chunk。

但最终保存到 `.zread/wiki/versions/.../*.md` 的页面里，并没有 `<blog>` 标签。当前更可信的判断是：

- `<blog>` 只是模型输出协议的一部分。
- Zread 在把模型流式结果写入版本目录前，会去掉外层包装，只保留实际 Markdown 正文。

这个差异很关键，因为它说明“模型输出协议”和“最终文件格式”并不完全相同。

## 与官方页面的对照

截至 2026-04-07，`https://zread.ai/cli` 官方页面宣称生成后会在项目目录下写入：

```text
.zread/
  state.json
  wiki/
    current
    versions/
    drafts/
```

而当前样本仓库里只观察到了：

- `wiki/current`
- `wiki/versions/<version-id>/...`

没有观察到：

- `state.json`
- `wiki/drafts/`

更合理的解释是：

- `state.json` 和 `drafts/` 可能只在生成中或某些状态下存在。
- 当前样本是一个“完成后且已被清理过”的版本目录快照。

## 对产品形态的反推

仅从落盘结果反推，Zread 至少具备这些后端/前端契约：

- 有版本化持久化，不是覆盖式生成。
- 有独立导航清单，不是纯文件浏览。
- 有 Markdown 渲染器、Mermaid 渲染器、表格渲染支持。
- 有基于 `slug` 的内部页面跳转。
- 有面向代码阅读的来源引用渲染能力。

如果后续要继续逆向 Web 端实现，`wiki.json + markdown pages + current pointer` 这一组文件已经足够构成一个本地只读 Wiki 浏览器。
