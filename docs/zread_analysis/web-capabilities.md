# Zread 的 Web 能力

本文把三类证据合在一起分析：

- 官方页面 `https://zread.ai/cli`
- 本地 `zread --help`、`zread browse --help`、`zread generate --help` 等命令
- `../deepwiki-open/.zread` 中已经落盘的 Wiki 产出物

目标不是猜测官网前端实现，而是确认“Zread 实际向用户提供了哪些 Web 能力”。

## 官方页面确认的能力

截至 2026-04-07，`https://zread.ai/cli` 页面明确给出的信息包括：

- `zread` 是默认入口命令，进入任意本地仓库后直接运行，会按当前状态建议下一步。
- CLI 的核心用途是把本地代码仓库转换成项目文档。
- 安装方式支持 `npm install -g zread_cli` 和 Homebrew。
- 典型流程是：进入仓库，运行 `zread`，然后根据提示登录、生成文档或打开已有文档。
- 如果文档已经存在，可以直接 `zread browse` 在浏览器中打开。
- 生成结果会存放在 `.zread/` 下，并且包含 `current`、`versions/`、`drafts/` 等版本化结构。

只看这一个页面，Zread 的产品形态已经不是“纯命令行摘要器”，而是“本地生成 + 本地浏览 + 版本化存储”的文档阅读工具。

## 本地 CLI 能力确认

本地安装的 `zread_cli@0.2.2` 帮助输出进一步把 Web 能力补全了。

### 默认命令

`zread --help` 显示的命令集包括：

- `browse`
- `config`
- `generate`
- `login`
- `update`
- `version`

这说明 Web 阅读只是其中一环，前后还包了账号配置、生成调度、升级等完整生命周期。

### 浏览相关命令

`zread browse --help` 可以确认这些能力：

| 选项 | 含义 |
| --- | --- |
| `--generate` | 如果当前没有文档，则直接开始生成，而不是返回菜单 |
| `--host` | 指定监听主机 |
| `--port` | 指定监听端口，未指定时从 `9681` 起自动探测 |
| `--version` | 显示版本选择界面，或直接打开某个版本 |
| `--stdio` | 机器可读模式 |

这意味着它的 Web 预览至少支持：

- 本地 HTTP 服务
- 端口自适应
- 版本切换
- “没有文档时直接跳转生成”这一体化工作流

### 生成相关命令

`zread generate --help` 还暴露了与 Web 体验强相关的状态能力：

| 选项 | 含义 |
| --- | --- |
| `--draft resume` | 续传已有草稿 |
| `--draft clear` | 清空草稿重新生成 |
| `--draft cancel` | 取消草稿处理 |
| `--skip-failed` | 跳过失败页面，提交剩余 Wiki |
| `-y, --yes` | 跳过所有确认步骤 |

这说明 Zread 的生成链路不是一次性原子写入，而是存在“草稿态”和“部分成功提交”的工作流控制。

### 登录与配置

`zread login --help` 与 `zread config --help` 表明：

- 登录面向“智谱/Z.AI Coding Plan”。
- `login` 支持 `--custom`，说明也允许绕过菜单直接手工配置 API Key。
- `login` 支持 `--model`，说明认证后可以直接指定模型。

从产品角度看，这意味着 Web 阅读前并不要求用户自己手写配置文件，CLI 已内建基础的账号/模型接入流程。

## 从 `.zread` 产出反推的 Web 呈现能力

即使不运行浏览器，只看落盘的 `.zread/wiki/versions/...` 文件，也能反推 Zread 预览页至少支持这些呈现能力：

| 能力 | 证据 | 结论 |
| --- | --- | --- |
| Markdown 正文渲染 | 页面正文为纯 Markdown | 需要基础 Markdown 渲染器 |
| 章节导航 | `wiki.json` 包含 section/group/slug | 需要导航树或目录面板 |
| 内部页面跳转 | 页面中出现 `[页面名](page_slug)` 链接 | 需要按 slug 路由或页内导航 |
| Mermaid 图表 | 页面包含 ```mermaid 代码块 | 需要 Mermaid 渲染器 |
| 表格显示 | 页面中有大量 Markdown 表格 | 需要表格样式与溢出处理 |
| 代码来源引用 | 每段后有 `Sources:` 行 | 需要可点击的源码引用展示 |
| 版本切换 | `browse --version` + `wiki/versions/` | 需要版本选择 UI |

这组能力合在一起，已经非常接近一个完整的“代码库知识 Wiki 阅读器”。

## Web 产品视角下的最小闭环

把官方页面、CLI 帮助和落盘产物合起来，Zread 的最小闭环可以还原成：

1. 用户进入本地仓库后运行 `zread`。
2. CLI 根据当前状态引导登录、生成或打开已有文档。
3. 生成结果写入 `.zread/wiki/versions/<version-id>/`。
4. `zread browse` 启动本地 Web 预览。
5. 浏览器读取 `wiki.json` 构建导航，再按页面 slug 加载对应 Markdown。
6. 页面中渲染 Markdown、Mermaid、表格、来源引用和跨页链接。
7. 用户可在不同生成版本之间切换。

这就是 Zread 的“CLI 生成 + Web 阅读”产品骨架。

## 已确认与未确认的边界

### 已确认

- 本地 Web 预览是 CLI 的正式能力，不是附属 demo。
- 存在版本选择能力。
- 生成链路存在草稿恢复和失败页面跳过机制。
- 页面渲染至少支持 Markdown、Mermaid、表格、来源引用和跨页链接。

### 仍未确认

- 本地 Web 服务的具体前端技术栈。
- 版本选择界面的具体交互样式。
- 页面是否支持全文搜索、源码侧边栏、暗色模式等更细的交互。
- `state.json` 与 `drafts/` 在完整生命周期中的精确状态机。

如果下一步要继续逆向 Web 实现，最值得优先跟的是：

- `browse` 启动的本地服务具体读哪些文件。
- `wiki.json` 如何映射到前端路由。
- 页面中的 `Sources:` 链接是否还能联动源码预览。
