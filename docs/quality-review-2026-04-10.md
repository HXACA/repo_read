# 本次产出质量 Review：RepoRead vs zread（deepwiki-open）

> 时间：2026-04-10
> RepoRead 产出：`deepwiki-open/.reporead/projects/deepwiki-open/versions/2026-04-10-011144/`（23 页，preset=quality，commit `cd4ff08b`，断点续跑）
> 对比基线：`deepwiki-open/.zread/wiki/versions/2026-04-06-123521/`（25 页，zread 生成）
> 目的：把主观观感转成可追踪的质量缺陷清单，作为下一轮优化的输入

---

## 0. 结论先行

| 维度 | 得分 | 一句话 |
|---|---|---|
| **目录规划（catalog）** | 🟡 可用但平 | 23 vs 25 页，覆盖面相当；但 zread 有 section+group 分组，RepoRead 只是一维平铺 |
| **单页结构深度** | 🟡 参差 | 6/8 对比页 RepoRead 行数更多，但很多是"verbose 而不是 dense"；zread 更紧凑 |
| **引用密度** | 🔴 差距明显 | RepoRead 平均 ~0.04-0.05 cites/line；zread 平均 ~0.12-0.17 cites/line（**3-4 倍差距**） |
| **Mermaid/代码示例** | 🟢 相当 | 两边都有图、都有代码片段，reporead 偶尔更啰嗦 |
| **输出完整性** | 🔴 **严重问题** | **16/23 页有 LLM 原始输出泄漏或内容截断**，严重影响可读性 |
| **事实准确性** | 🟡 整体 OK | 采样 4 页未发现硬性事实错误；但由于截断，后半部分内容缺失 |
| **整体可交付度** | 🔴 **当前不可直接对外** | 必须先修 §3 的输出提取 bug，否则用户看到的内容会带 "Now I have..." 开头 |

**一句话**：管线跑完了，Phase 3 严格 reviewer 确实在卡关键页面，但 **PageDrafter 的输出解析逻辑存在重大 bug**，导致 70% 的页面带 LLM 思维链 preamble、markdown 包裹壳、或 token 截断。**主要拉开差距的不是内容质量，而是后处理鲁棒性。**

---

## 1. 目录结构对比

### 页数与覆盖

| | RepoRead | zread |
|---|---|---|
| 页数 | 23 | 25 |
| 总行数 | 8162 | 7419 |
| 平均页长 | ~355 行 | ~297 行 |
| 目录分组 | 扁平列表 | section + group 两级 |

**差距点**：
- zread 把页面按"快速开始 / 深入理解：架构与核心模块 / 集成与扩展"三个 section 组织，且在 section 内部还有 group（如"后端核心引擎"），阅读顺序有明确叙事节奏
- RepoRead 当前 `WikiJson.reading_order` 是一维 array，虽然 order 是合理的（Project overview → Architecture → Quick start → Backend → Frontend → Deployment → Advanced），但前端没有可视化的 section 分隔

**对应代码**：`packages/core/src/types/generation.ts` 的 `WikiJson` 类型 —— 没有 `sections` 或 `groups` 字段

### 页面级对齐（8 对采样）

| RepoRead slug | zread slug | 主题是否匹配 |
|---|---|---|
| project-overview | 1-项目概述 | ✅ |
| quick-start-guide | 2-快速上手 | ✅ |
| docker-deployment | 3-Docker 容器化 | ✅ |
| architecture-overview | 4-系统整体架构 | ✅ |
| data-pipeline | 5-数据流水线 | ✅ |
| rag-implementation | 6-RAG 检索增强生成 | ✅ |
| internationalization | 18-国际化 | ✅ |
| wiki-cache-system | 24-wiki 缓存 | ✅ |

**结论**：主题覆盖一致，RepoRead 的 catalog planner 与 zread 在挑选"值得写的页面"上水平相当。

---

## 2. 单页内容对比

### 行数与引用密度

| 页面主题 | zread 行/引用/密度 | reporead 行/引用/密度 | 密度倍数（zread ÷ reporead） |
|---|---|---|---|
| project-overview | 224 / 33 / **0.147** | 74 / 0 / **0.000** | ∞（reporead 零引用） |
| rag-implementation | 288 / 37 / **0.128** | 500 / 14 / **0.028** | **4.6×** |
| architecture-overview | 273 / 45 / **0.165** | 425 / 23 / **0.054** | **3.0×** |
| internationalization | 367 / 60 / **0.163** | 73 / 6 / **0.082** | 2.0×（但 reporead 被截断） |
| docker-deployment | 309 / 36 / **0.116** | 449 / 17 / **0.038** | **3.1×** |
| wiki-cache-system | 259 / 30 / **0.116** | 366 / 16 / **0.044** | **2.6×** |

**观察**：
1. RepoRead 的内容**更长**但**引用更稀**——典型"verbose padding"信号，说明 drafter 倾向于用"平文段落描述"而不是"带引用的具体代码事实"
2. zread 每 2-3 段必有一个 `Sources:` 行，引用结构化地紧跟在内容后面
3. RepoRead 的 `[cite:file:...]` 多数出现在 `[cite:...:1-203]` 这种"整文件大段引用"而不是 zread 的 `#L82-L93` 这种精准 1-10 行锚点

**对应根因**：
- `reviewer-prompt.ts` 虽然要求 verify min citations，但对**密度**没要求
- `page-drafter-prompt.ts` 的 instruction 里虽然说"every key claim needs a citation"，但没有 explicit 的 "每段 ≥1 citation" 硬约束
- QualityProfile 里没有 `minCitationDensity` 这样的字段

---

## 3. 🔴 关键 Bug：输出提取不鲁棒

### 3.1 LLM 思维链 preamble 泄漏

**受影响的页面**（11/23，48%）：
```
api-endpoints.md         "Now I have all the necessary information..."
ask-component.md         "Now I have all the necessary information..."
frontend-app-structure.md
internationalization.md
model-providers.md
prompts-system.md
quick-start-guide.md
rag-implementation.md
wiki-cache-system.md
wiki-display-components.md
wiki-generation-flow.md
```

**复现示例**（`rag-implementation.md:1-4`）：
```markdown
Now I have all the necessary information to write a comprehensive wiki page about the RAG implementation. Let me create the complete page.

```markdown
# RAG 检索增强生成
```

**成因分析**：
- `packages/core/src/generation/page-drafter.ts:62-84` 的 `parseOutput()` 只处理了末尾的 `` ```json `` 块，没有处理：
  1. 开头的 LLM 思维链 preamble（"Now I have..." / "Let me write..." / "Based on the evidence..."）
  2. 内容被包裹在外层 `` ```markdown ... ``` `` fence 里
- 当 QualityProfile 是 `quality` + reviewer 强制重试时，drafter 经常被要求"重新撰写"，此时 Claude 模型会自然产出"Now I have gathered all the context, let me write..."然后把整个 page 用 ` ```markdown ` 包起来
- PageDrafter 只做了 `text.slice(0, jsonMatch.index).trim()`，没有进一步 strip 这两个伪影

**修复路径**（建议 P0 下个批次）：
```ts
// parseOutput() 里 markdown 得到后追加：
markdown = markdown
  .replace(/^[^#]*?(?=^#)/ms, "")          // 去掉首个 '#' 之前的所有 preamble
  .replace(/^```markdown\s*\n/, "")        // 去掉开头的 ```markdown 栅栏
  .replace(/\n```\s*$/, "")                // 去掉结尾的 ``` 栅栏
  .trim();
```

单测应覆盖三种污染：preamble、markdown fence、两者混合。

### 3.2 Token 截断（输出达到 max_tokens 上限）

**受影响的页面**（16/23，70%，含 3.1 的页面）：

按严重度分档：

**🔴 内容截断（正文切掉）**：
- `internationalization.md` — 73 行就结束，停在"每个翻译文件（以 `en.json` 为例）包含以下顶级命名空间："
- `ask-component.md` — 停在 `<div className="h-2 w-2 bg-purple-600` 中间
- `configuration-system.md` — 停在"在配置文件中使用环境变量占位符："
- `file-filtering-rules.md` — 停在 `documents = read_all_documents(`
- `frontend-app-structure.md` — 停在 mermaid 中间 `end`
- `wiki-generation-flow.md` — 停在 mermaid 中间 `S -->|无缓存`
- `backend-entry-point.md` — 停在正文中间（被"安全的日志轮"打断）
- `docker-deployment.md` — 停在命令行中间

**🟡 JSON metadata 截断（正文完整但尾部 JSON 不完整）**：
- `architecture-overview.md` — `"note": "Next.js` 处截断
- `wiki-cache-system.md` — `"target": "api/api.py` 处截断
- `model-client-base.md` — `"related_pages": ["` 处截断
- `advanced-features.md` — `"summary"` 截断
- `api-endpoints.md` — `"summary"` 截断
- `export-functionality.md` — `"summary"` 截断
- `rag-implementation.md` — `"summary"` 截断

**🟢 正常结尾**（仅 7/23）：
- `project-overview.md`、`chat-api-streaming.md`、`data-pipeline.md`、`private-repo-access.md`、`export-functionality.md`（正文完整但 metadata 坏）等少数

**成因**：
- AI SDK / Claude 默认 `max_tokens` 通常是 4096-8192；quality preset 下 drafter 步数预算 30 步，但**单次 LLM call 的输出 token 上限从未显式设置**
- 页面正文 + [cite:...] 注释 + mermaid + JSON metadata 总和经常 > 4000 tokens
- 当 LLM 被 reviewer 要求"revise"并重写时，context 里已经有 previous_draft，输出空间被进一步压缩

**修复路径**：
1. `PageDrafter.draft()` 显式传 `maxOutputTokens: 8192`（或 16384）给 AI SDK 的 `generateText`
2. `parseOutput()` 应检测"截断"信号（JSON 无法 parse + 正文结尾非标点/代码块 closer），返回 `success: false` 让 pipeline 进入 revise 重试
3. Reviewer 应把 "response appears truncated" 也加入 blocker 列表

**对应文件**：`packages/core/src/generation/page-drafter.ts` + `page-drafter-prompt.ts`

### 3.3 `[cite:...]` 标记密度不足

- zread 平均每 3-5 行一个 `Sources:` 段，`Sources:` 段内含 2-6 个行号级引用
- reporead 平均每 15-30 行一个 `[cite:...]`，且经常是整段引用（`:1-635`），失去精准定位价值

这与 3.1/3.2 是独立的、更深层的 drafter prompt 问题。修复方式是 prompt 里加 "每一条非通用陈述都必须以 `[cite:file:...:N-M]` 结尾，locator 范围 ≤30 行" 的硬性约束。

---

## 4. zread 的可借鉴做法

采样 zread 后，有几条明显做得更好的点值得学：

1. **`Sources:` 脚注模式**
   zread 每 2-3 段就有一行 `Sources: [file](path#L10-L20), [file2](path#L5-L15)`，这种结构化的、人类可读的引用锚点比 reporead 的行内 `[cite:...]` 更清晰、更容易被渲染层高亮

2. **段落首句叙事**
   zread 每一节第一段几乎都是"故事式"开头（例："欢迎来到 DeepWiki-Open 的世界。如果你曾面对一个陌生的代码仓库感到无从下手——"）。这是"documentation voice"，而 reporead 的开头更像"技术 SPEC"（例："DeepWiki-Open 采用经典的前后端分离架构"）

3. **"谁适合使用 DeepWiki-Open"段**
   zread 的 project-overview 里专门有"开源贡献者 / 团队技术负责人 / 企业 DevOps / AI 应用开发者"四种读者画像的 4 段。这是典型的 product-voice，reporead 完全没有这个角度

4. **推荐阅读路径**
   zread 每个 overview 页尾部都有"🚀 快速上手路径 / 🏗️ 架构深入路径 / 🔌 集成与扩展路径"三条 curated 路径，每条 2-3 页 link。reporead 只有一个 `relatedPages` 字段且长度常常是 0-1

5. **section / group / level 元数据**
   zread 的 wiki.json 每页有 `section`、`group`、`level: Beginner/Intermediate/Advanced` 字段。这让前端可以按难度过滤，按主题折叠。reporead 的 catalog 只有 `order`

---

## 5. 新增 gap 清单（回写到 implementation-gap 文档）

下列每条都应该追加到 `docs/implementation-gap-2026-04-10.md` 对应节：

### G-15 🔴 PageDrafter 输出提取不鲁棒（§2.x 新增）
- 症状：11/23 页带 `Now I have...` preamble，多数页被包裹在 `` ```markdown `` fence 里
- 根因：`page-drafter.ts:62-84 parseOutput()` 没有 strip preamble 和外层 fence
- 风险：🔴 高——用户直接看到 LLM 思维链，严重损害可信度
- 建议 P0

### G-16 🔴 Drafter 输出达到 max_tokens 导致内容截断
- 症状：16/23 页出现正文或 metadata 截断
- 根因：`page-drafter.ts` 的 `generateText` 调用未设置 `maxOutputTokens`
- 建议 P0：显式传 16384 + 加截断检测 + 让 reviewer 将截断视为 blocker

### G-17 🟡 引用密度缺乏硬约束
- 症状：reporead 每页引用密度只有 zread 的 1/3 - 1/4
- 根因：drafter prompt + reviewer 都没有密度阈值要求
- 建议 P1：QualityProfile 新增 `minCitationsPerSection`，reviewer 检查并 promote 为 blocker

### G-18 🟡 Catalog 没有 section/group 元数据
- 症状：前端目录扁平，无叙事节奏
- 根因：`WikiJson` 类型只有一维 `reading_order`
- 建议 P2：`ReadingOrderItem` 新增可选 `section?: string` / `group?: string` / `level?: "beginner"|"intermediate"|"advanced"`

### G-19 🟡 Drafter voice 偏 SPEC 而非 documentation
- 症状：开头段落像技术规格说明，缺读者视角、缺"为什么"
- 根因：prompt 没有 "documentation voice" 指导
- 建议 P2：prompt 追加 "以读者视角开头，先解释'为什么'再说'怎么做'"

### G-20 🟢 relatedPages 经常为空
- 症状：reporead 多页的 `related_pages` 数组长度为 0 或 1
- 根因：drafter 对"相关页面"的生成没有 incentive
- 建议 P2：让 reviewer 也检查 relatedPages 数量 ≥2

---

## 6. 建议下一批次的 P0

重新规划 P0（覆盖本次 review 发现的硬 bug）：

1. **P0-4 修复 PageDrafter 输出提取（G-15）** — 2-3h，立即做
2. **P0-5 设置 maxOutputTokens + 截断检测（G-16）** — 2h，立即做
3. **P0-6 重跑一次 deepwiki-open 验证** — 跑 1 页就行，验证 preamble 消失 + 无截断
4. **P0-7（可选）引用密度硬约束（G-17）** — 3-4h

**P0-4 + P0-5 是现在就应该做的。** 不修这两个，所有下游的"route dispatch / strictness / research"等工作都无法体现在用户眼前——因为用户第一眼看到的是 "Now I have all the necessary information..."。

---

## 7. 客观打分

在"不修 bug"的前提下对本次产出打分：

| 维度 | 分数 | 说明 |
|---|---|---|
| 主题覆盖 | 8/10 | 与 zread 齐平 |
| 引用密度 | 4/10 | 差距 3-4 倍 |
| 结构深度 | 6/10 | 有 mermaid 有代码但缺乏层次 |
| 可读性 | 5/10 | verbose 但不够 dense |
| **输出完整性** | **2/10** | 70% 页面有 preamble 或截断 |
| 事实准确性 | 7/10 | 抽样未发现硬错 |
| **综合（可直接交付）** | **3/10** | 必须修完 P0-4/P0-5 再谈 |
| **综合（修完后预期）** | **6/10** | 和 zread 还有差距但可用 |

---

## 8. 结论

这份 review 把本轮产出的问题分成三类：

1. **管线工作正常**——resume 成功、reviewer 重试循环触发、quality preset 确实提高了严格度
2. **但关键 bug 被重试循环放大**——strict reviewer 让 drafter 多次"revise"，而每次 revise 都用 `` ```markdown ``` `` 把答案包起来，又每次都顶 max_tokens，最终 48% 的页面带 preamble、70% 页面有截断
3. **质量差距的一半来自 drafter prompt 本身**——引用密度、叙事 voice、关联页面数都是 prompt-level 可解的问题

**下一步建议**：立即做 P0-4 + P0-5（2 个硬 bug），然后用 budget preset 重跑 deepwiki-open 一次做对比。不建议继续推 P1 Ask session / Evidence 重规划 等项目，直到 drafter 输出质量达标。
