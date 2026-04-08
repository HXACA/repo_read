# Zread Prompt 模板与渲染规则

这份文档不重复保存原始 prompt 文本，而是回答 4 个问题：

1. Zread 在哪些阶段会向模型发送 prompt。
2. 每个阶段的 prompt 哪些部分是固定模板，哪些部分是运行时渲染出来的。
3. `docs/zread_analysis/prompts/*.txt` 这些文件和真实请求之间是什么关系。
4. `zread-proxy/captures/*.json` 里可以反推出哪些隐藏规则。

## 先说结论

- `docs/zread_analysis/prompts/` 里并不只有 system prompt，也包含 1 份 catalog user prompt 和 25 份 page user prompt。
- 这些 `*-user.txt` 不是“源码级模板”，而是从首轮请求里提取出的“已经渲染完成的实例”。
- 从抓包看，Zread 至少有两个生成阶段：
  - 阶段 1：先生成整站 catalog。
  - 阶段 2：再按 catalog 中的每个 page，分别启动新会话生成页面正文。
- page 阶段的 system prompt 基本固定，真正按页面变化的是 user prompt。
- page user prompt 不是只塞一个标题，而是把“当前页标题 + 难度 + 全量目录导航 + 当前页高亮 + 仓库结构快照 + 输出格式约束”一起拼进去。

## 证据来源

- 原始请求抓包：`zread-proxy/captures/*.json`
- 提取后的 prompt 原文：[`prompts/`](./prompts/)
- 页面与 slug 对应关系：`deepwiki-open/.zread/wiki/versions/2026-04-06-123521/wiki.json`

## Prompt 家族总览

| 家族 | 文件 | 角色 | 是否固定 | 说明 |
| --- | --- | --- | --- | --- |
| Catalog System | [`prompts/catalog-system.txt`](./prompts/catalog-system.txt) | system | 基本固定 | 规定目录生成的人设、分析框架、输出 XML 结构、工具使用原则。 |
| Catalog User | [`prompts/catalog-user.txt`](./prompts/catalog-user.txt) | user | 运行时渲染 | 注入工作目录、操作系统、语言、仓库顶层结构，并要求只输出 catalog。 |
| Page System | [`prompts/page-system.txt`](./prompts/page-system.txt) | system | 基本固定 | 规定页面写作人格、证据标准、图表偏好、交叉引用规则、工具协议。 |
| Page User | [`prompts/page-01-user.txt`](./prompts/page-01-user.txt) 到 [`prompts/page-25-user.txt`](./prompts/page-25-user.txt) | user | 运行时渲染 | 针对单页注入当前页标题、Audience、全量导航树、当前页标记、输出包装格式等。 |

## 阶段 1：Catalog 生成

### 目标

让模型先产出一个“文档目录”，而不是直接写正文。这个目录既是最终 wiki 的导航骨架，也是后续 page prompt 的输入来源。

### Catalog System Prompt 的固定部分

这一层负责定义“怎么分析仓库”和“怎么输出目录”，核心包含：

- 角色设定：资深软件工程师 + 技术写作者。
- 工具说明：`get_dir_structure`、`view_file_in_detail`、`run_bash`。
- 分析框架：Why / What / Who / How to Present 四步。
- 输出约束：必须输出 `<section> / <topic level=\"...\"> / <group>` 结构，总 topic 数不超过 30。

这一层基本不含仓库特有内容，属于跨仓库复用模板。

### Catalog User Prompt 的渲染块

Catalog user prompt 是“固定说明 + 运行时元数据”的组合。抓包里能稳定看到下面这些块：

| 块 | 是否渲染 | 作用 | 典型来源 |
| --- | --- | --- | --- |
| `Produce a comprehensive document catalog...` | 固定 | 定义当前任务是产出 catalog。 | 内置模板 |
| `## Instructions` | 固定 | 指定优先使用哪些工具、如何推进。 | 内置模板 |
| `Working directory` | 渲染 | 告知当前本地仓库根路径。 | CLI 运行时 |
| `Operating system` | 渲染 | 告知执行环境。 | CLI 运行时 |
| `Documentation language` | 渲染 | 约束输出语言。 | CLI 参数或默认语言 |
| `Repository structure (top levels)` | 渲染 | 提前给模型一个仓库总览，减少首轮盲查。 | 本地目录扫描结果 |
| `Output ONLY the document catalog` | 固定 | 阻止模型提前写说明文字。 | 内置模板 |

### Catalog 阶段的渲染规则

可以归纳成下面的伪模板：

```text
[固定 catalog user 指令]

## Your Task
Information about the current repository:
<metadata>
Working directory: {{working_dir}}
Operating system: {{os}}
Documentation language: {{language}}

Repository structure (top levels):
{{repo_tree_top_levels}}
</metadata>

[固定输出约束]
```

### Catalog 阶段的隐含规则

- 目录树不是全文展开，而是“顶层结构快照”，作用是给模型第一眼的全局印象。
- tools 不是写在 user prompt 里，而是通过 API 的 `tools` 字段单独注入。
- 首轮请求只有两条 message：`system` 和 `user`。
- 后续回合会把 `assistant` 和 `tool` 结果继续拼回 `messages`，但首轮的 system/user 内容保持不变。

## 阶段 2：Page 生成

### 目标

对 catalog 中的每一页单独拉起一个新会话，写出该页正文。

### Page System Prompt 的固定部分

这一层定义“页面作者人格”和“写作工法”，与具体页面无关。核心包括：

- INTJ 技术文档架构师身份。
- Diátaxis + AIDA 的写作框架。
- 段落级证据标准。
- Mermaid、表格、交叉引用的偏好。
- 假设驱动的工具使用协议。

这说明 page 阶段把“写作风格”和“页面主题变量”拆开了：风格在 system，主题在 user。

### Page User Prompt 的渲染块

page user prompt 的结构非常稳定，几乎每页都遵循同一骨架。

| 顺序 | 块 | 是否渲染 | 作用 |
| --- | --- | --- | --- |
| 1 | `## CURRENT MISSION` | 渲染 | 注入当前页标题、Audience、语言、工作目录、操作系统。 |
| 2 | `## ENVIRONMENT` | 渲染 | 注入仓库 top 2 levels 树，给当前页面写作共享一个统一的仓库快照。 |
| 3 | `## NAVIGATION CONTEXT` | 渲染 | 注入完整 catalog，并用 `[You are currently here]` 标记当前页。 |
| 4 | `**Content Boundaries**` | 渲染 | 强制“只写当前页，不越界写其他页面”。 |
| 5 | `## DOCUMENT TYPE REQUIREMENTS` | 固定为主，带少量变量 | 规定全局证据格式，以及 Overview / How-to / Explanation 三类页面写法偏好。 |
| 6 | `## OUTPUT FORMAT` | 渲染 | 把当前页标题塞进 `<blog>` 示例模板中。 |
| 7 | `## EXECUTE NOW` | 渲染 | 用当前页标题拼出最后的执行指令。 |

### Page 阶段的核心变量

从抓包和 `wiki.json` 可以反推出 page user prompt 至少使用了这些变量：

| 变量 | 在 prompt 中的表现 | 推断来源 |
| --- | --- | --- |
| `working_dir` | `**Working directory**: ...` | CLI 运行时 |
| `os` | `**Operating system**: darwin` | CLI 运行时 |
| `language` | `**Documentation language**: Chinese` | CLI 参数或默认语言 |
| `page.title` | `**Current Page**`、`Content Boundaries`、`# 标题`、`EXECUTE NOW` | catalog 结果 / `wiki.json` |
| `page.level` | `**Audience**: Beginner/Intermediate/Advanced level developers` | catalog 结果 / `wiki.json.level` |
| `page.slug` | 导航链接中的 `(page_slug)` | catalog 结果 / `wiki.json.slug` |
| `catalog.full_tree` | `Full Catalog with Your Position` 整段 | catalog 结果序列化 |
| `current_marker` | `[You are currently here]` | 当前 page 与 catalog 对位后插入 |
| `repo_tree_depth_2` | `Repository structure (top 2 levels)` | 本地目录扫描结果 |

### Audience 的渲染规则

这部分不是自由生成，而是直接把 page 的 level 翻译成固定短语：

| Level | Audience |
| --- | --- |
| `Beginner` | `Beginner level developers` |
| `Intermediate` | `Intermediate level developers` |
| `Advanced` | `Advanced level developers` |

### Navigation Context 的渲染规则

这一块最关键，也最能说明 page user prompt 不是静态文本。它包含 3 个特点：

- 整个 catalog 会被完整展开，而不是只给当前页附近的局部上下文。
- 当前页会被额外标记 `[You are currently here]`。
- section、group、topic 的层级会被保留成缩进文本，链接直接使用 catalog slug。

这说明 page prompt 的目标不只是“写一页”，而是“在整站结构中写一页”，避免模型不知道该页和其他页怎么分工。

### Page 阶段的伪模板

```text
## CURRENT MISSION
**Working directory**: {{working_dir}}
**Operating system**: {{os}}
**Current Page**: "{{page.title}}" documentation
**Audience**: {{audience_from_level(page.level)}}
**Documentation language**: {{language_name}}

## ENVIRONMENT
Repository structure (top 2 levels):
{{repo_tree_depth_2}}

## NAVIGATION CONTEXT
**Full Catalog with Your Position**:
{{render_catalog_with_current_marker(catalog, page.slug)}}

**Content Boundaries**:
- Write ONLY about "{{page.title}}"
- Identify your current position marked with "[You are currently here]"
- Reference other pages by their exact catalog links when suggesting next steps

## DOCUMENT TYPE REQUIREMENTS
[固定写作约束]

## OUTPUT FORMAT
<blog>
# {{page.title}}
...
</blog>

## EXECUTE NOW
Deliver "{{page.title}}" documentation ...
```

## 从 `wiki.json` 到 page prompt 的推断链

`deepwiki-open/.zread/wiki/versions/2026-04-06-123521/wiki.json` 中保存了每页的：

- `slug`
- `title`
- `section`
- `group`
- `level`

而 page user prompt 中恰好需要：

- 当前页标题
- 当前页 slug
- 当前页 level 对应的 audience
- 全量导航树中的 section/group/topic 排列
- 当前页高亮位置

因此可以比较确定地说：page user prompt 并不是手写 25 份独立模板，而是“同一个 page 模板 + catalog 结构化结果 + 当前页上下文”的渲染产物。

## 会话层面的运行协议

从 `captures` 还能看出 prompt 之外的 3 条重要规则。

### 1. 一页一个新会话

本地样本里可以确认：

- 1 个 catalog 生成会话
- 25 个 page 生成会话

每个页面不是接在 catalog 会话后面继续问，而是重新开一个以该页为中心的新对话。

### 2. 首轮只有 `system + user`

无论 catalog 还是 page，首轮都是：

```json
messages = [
  { "role": "system", ... },
  { "role": "user", ... }
]
```

之后才会把 assistant 的 reasoning、tool call、tool result 接回去。

### 3. tools 是“旁路注入”，不是 prompt 文本的一部分

在真实请求里，工具通过 `tools` 字段单独传给模型，prompt 文本只做“工具使用协议说明”。这意味着：

- system/user prompt 负责行为约束。
- `tools` 字段负责能力声明。
- 两者是并行注入，不是字符串拼接。

## 抓包里能确认的隐藏规则

### 规则 1：所有页面都收到三类文档写法要求

无论当前页更像 Overview、How-to 还是 Explanation，page user prompt 都会把这 3 组要求完整塞进去，而不是只按页型裁剪一组。

这是一种“宁可给全，不做分类分支”的模板设计。

### 规则 2：仓库树快照在所有页面里重复出现

page 阶段没有只给页相关文件，也没有只给局部目录，而是把统一的 top 2 levels 仓库结构重复注入到每一页。

这说明 Zread 倾向于给模型稳定的全局感，而不是极端压缩上下文。

### 规则 3：导航树是 page prompt 的核心，而不是附属说明

`Full Catalog with Your Position` 占了 page user prompt 中非常大的比重，说明 Zread 很依赖“整站导航上下文”来约束单页写作边界。

### 规则 4：输出要求 `<blog></blog>`，落盘时会被清洗掉

page user prompt 明确要求最终结果包裹在 `<blog></blog>` 中，但 `.zread/wiki/versions/.../*.md` 的最终落盘文件没有这层包裹。

这意味着在“模型流式输出”与“最终 Markdown 文件”之间，至少还有一层结果清洗或提取逻辑。

## 为什么你会感觉“现在只看到了 system prompt”

主要是因为：

- system prompt 文件名更显眼，且每类只有 1 份。
- page user prompt 被拆成了 25 份实例文件，不容易第一眼看出它们其实共享同一个模板骨架。
- 当前目录里保存的是“实例化后的 prompt”，没有保存“未渲染模板源码”。

所以更准确的说法是：

- 现在已经保存了 system prompt。
- 也已经保存了 user prompt 的实例。
- 这次新增的文档负责把“实例背后的模板规则”补出来。

## 建议怎么继续看

1. 先看 [`prompts/prompt-index.md`](./prompts/prompt-index.md)，确认每份原始 prompt 对应哪个捕获 ID。
2. 再对照 [`prompts/catalog-user.txt`](./prompts/catalog-user.txt) 和任意一个 `page-xx-user.txt`，感受两阶段结构差异。
3. 最后结合 `zread-proxy/captures/*.json` 看首轮与续轮请求，理解 prompt、tool、history 是怎么拼起来的。
