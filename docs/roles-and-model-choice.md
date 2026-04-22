# Roles 定位与模型选型

RepoRead 的生成流水线把任务拆成 **5 个 role**：`catalog` / `outline` / `drafter` / `worker` / `reviewer`。每个 role 的职责、I/O 体积、推理依赖度、调用频率差别很大，所以**不应该全都用同一个模型**。这份文档讲清楚每个 role 做什么、为什么要那样选、以及三种典型组合（quality / speed / budget）。

配置位置：`~/.reporead/config.json` 顶层 `roles: { <role>: { primaryModel: "...", ... } }`；或项目级覆盖在 `<repo>/.reporead/projects/<slug>/config.json`。

---

## 5 个 Role 速览

| Role | 每 job 调用 | 单次输入规模 | 是否用 tool-calling | 是否吃 reasoning | 对推理要求 |
|---|---|---|---|---|---|
| `catalog` | 1 次（最多 retry 3 次） | 30k - 400k | **是**（repo_structure / read / grep） | 是 | **高** |
| `outline` | 每页 1 次 | 15k - 35k | 否 | 否 | 中 |
| `drafter` | 每页 1-5 次（revision 循环） | 200k - 2.6M | **是**（密集搜证据） | 是 | 中偏高 |
| `worker` | drafter 内部 fork 并发调用 | 变化大 | 是 | 否 | 中 |
| `reviewer` | 每页 1-5 次（随 revision 触发） | 40k - 400k | 是（验证引用） | **是** | **高** |

---

## Role × Role 详解

### 1. `catalog` — 目录规划

**做什么**：拿到整个仓库的 profile（文件树 + README + 关键文件抽样），生成 `wiki.json`（`summary` + `reading_order[]`）。这是整本书的骨架。

**特点**：
- **全局视野**：必须读得懂整个项目的架构意图，能从 1000+ 文件里归类出 N 个逻辑主题、排出合理阅读顺序
- **工具调用**：用 `dir_structure` / `read` / `grep` 在仓库里钻取关键文件
- **一失败全失败**：catalog 挂了整个 job 就 fail，所以用最稳最强的模型
- **调用稀疏**：每 job 只跑 1 次，单次贵点没关系

**推荐档位：强推理模型**
- GPT-5.4 / Claude Opus 4.7 / Claude Sonnet 4.7
- `reasoningEffort: "high"`

---

### 2. `outline` — 页大纲

**做什么**：针对 catalog 分配给一页的 `coveredFiles`，产出 `PageOutline`（小节结构、mechanism 列表、readerGoal）。是 drafter 的蓝图。

**特点**：
- **输入小、输出结构化**：15-35k input，JSON 输出
- **无工具调用**：文件内容已经由 prefetcher 提前拉好，outline 只做规划
- **每页必跑 1 次**：50 页就是 50 次，量大，**速度和成本敏感**
- **对推理要求中等**：主要是把小节切分合理、mechanism 不重不漏

**推荐档位：快速中型模型**
- MiniMax-M2.7-highspeed / GPT-5-mini / Gemini Flash / Claude Haiku 4.5
- 不需要 reasoning

---

### 3. `drafter` — 页起草

**做什么**：按 outline 写完整的 markdown 页面，包含每条论断的 `[cite:file:path:line]` 证据引用。

**特点**：
- **输入最大**：单次可达 2.6M tokens（带上下文 + 已发布页摘要 + 证据池）
- **Tool-calling 最密集**：`read` / `grep` / `find_files` 各数十次，去仓库里找证据
- **调用最频繁**：每页 1 次起，最多 revision 5 次 = 5 次
- **对"写作流畅度 + 工具调用正确率"要求高**，对"纯推理"要求中等
- **最大成本来源**：在 hermes V8 benchmark 里，drafter 贡献了 ~70% 的 input token

**推荐档位：tool-calling 强 + 便宜 + 快**
- MiniMax-M2.7-highspeed（极推荐，便宜 + 快，大 context window）
- GPT-5-mini / Claude Haiku 4.5
- 避免用 Opus/GPT-5.4 级别，性价比太低

---

### 4. `worker` — Fork 子任务

**做什么**：drafter 在预取证据时会 fork 若干并发 sub-agent（`evidence-coordinator`），每个 worker 并行跑一批 tool-calling 收集特定机制的证据，最后把结果合并回 drafter。

**特点**：
- **短生命周期、高并发**：一次 drafter 可能 fork 5-10 个 worker
- **输入中等（100-500k）、输出小**（结构化 finding）
- **和 drafter 深度耦合**：通常和 drafter 用同一个模型最省心（prompt 格式、tool 集合一致）

**推荐档位：和 drafter 同档或更轻**
- 默认 = 和 drafter 相同模型
- 如果想省：可以单独换更便宜的（GPT-5-mini-nano / Gemini Flash）

---

### 5. `reviewer` — 审稿 + 质量门

**做什么**：拿到 draft markdown + evidence ledger + outline + coveredFiles，做以下判断：
- 每条 `[cite:...]` 的引用是不是真指向存在的代码？
- outline 里的 mechanisms 是否都被正文覆盖？
- 结构 / 长度 / 术语是否和 reader goal 匹配？
- 输出 verdict = `accept` / `revise` + 具体的 coverage blocker / citation verdict

**特点**：
- **推理密度最高**：要验证几十到几百条引用，做 mechanism → 正文匹配
- **是质量闭环的核心**：reviewer 松，成品就水；reviewer 严，revision 多但最终质量高
- **吃 reasoning tokens**：在 hermes V8 里是 reasoning 消耗大户
- **对 coverage enforcement=strict 模式尤其关键**

**推荐档位：强推理模型**
- GPT-5.4 / Claude Opus 4.7 / Claude Sonnet 4.7
- `reasoningEffort: "high"` 在 strict 模式下强烈推荐

---

## 三种推荐组合

### ⚡ Speed-first（最便宜最快，粗糙 draft 场景）

| role | 模型 |
|---|---|
| catalog | GPT-5-mini / Claude Haiku 4.5 |
| outline | MiniMax-M2.7-highspeed |
| drafter | MiniMax-M2.7-highspeed |
| worker | MiniMax-M2.7-highspeed |
| reviewer | GPT-5-mini / Claude Haiku 4.5 |

**适合**：小仓库（<200 文件）、试用、快速出 demo。`coverageEnforcement: "off"`。

---

### ⚖️ Balanced（质量合格 + 成本可控，**推荐默认**）

| role | 模型 |
|---|---|
| catalog | **GPT-5.4** / Claude Sonnet 4.7（reasoningEffort: high） |
| outline | MiniMax-M2.7-highspeed |
| drafter | MiniMax-M2.7-highspeed |
| worker | MiniMax-M2.7-highspeed |
| reviewer | **GPT-5.4** / Claude Sonnet 4.7 |

**适合**：中大仓库（200-2000 文件）、常规生产。`coverageEnforcement: "warn"`。

这就是 hermes V8 benchmark (50 页) 实测用的组合：**4h11m 完成 + 1,221 requests**。

---

### 🎯 Quality-first（strict coverage + 高精度引用）

| role | 模型 |
|---|---|
| catalog | **Claude Opus 4.7** / GPT-5.4-high |
| outline | GPT-5.4-mini / Claude Sonnet 4.6 |
| drafter | Claude Sonnet 4.7 / GPT-5.4 |
| worker | Claude Sonnet 4.7 / GPT-5.4 |
| reviewer | **Claude Opus 4.7** / GPT-5.4-high |

**适合**：要发给资深工程师当 onboarding 正式材料、或者要求每条 mechanism 都有引用证据。`coverageEnforcement: "strict"`。

---

## 实测数据（hermes V8 benchmark，Balanced 组合）

- **50 页** / 4h11m / 1,221 requests
- **gpt-5.4（catalog + reviewer）**：507 reqs / 16M input / 650k output / 162k reasoning
  - 单请求平均：**~31k input、320 output、**<span> **超大 reasoning**</span>
- **MiniMax-M2.7-highspeed（outline + drafter + worker）**：714 reqs / 11.4M input / 488k output / 0 reasoning
  - 单请求平均：**~16k input、680 output**

**按 role 拆成本结构（hermes V8）**：

| Role | 占 input token 比例 | 占请求数比例 |
|---|---|---|
| evidence（drafter 内部）| ~40% | ~30% |
| draft | ~30% | ~25% |
| review | ~10% | ~20% |
| outline | ~3% | ~10% |
| catalog | ~0.4% | 0.2% |
| validate | 0（本地不调用 LLM） | 0 |

结论：**drafter + worker 是省钱关键点，reviewer + catalog 是质量关键点**。混搭才是正解。

---

## 配置示例

`~/.reporead/config.json`（Balanced 组合）：

```json
{
  "roles": {
    "catalog": {
      "primaryModel": "kingxliu-openai/gpt-5.4",
      "resolvedProvider": "kingxliu-openai",
      "reasoningEffort": "high"
    },
    "outline": {
      "primaryModel": "kingxliu-openai/MiniMax-M2.7-highspeed",
      "resolvedProvider": "kingxliu-openai"
    },
    "drafter": {
      "primaryModel": "kingxliu-openai/MiniMax-M2.7-highspeed",
      "resolvedProvider": "kingxliu-openai"
    },
    "worker": {
      "primaryModel": "kingxliu-openai/MiniMax-M2.7-highspeed",
      "resolvedProvider": "kingxliu-openai"
    },
    "reviewer": {
      "primaryModel": "kingxliu-openai/gpt-5.4",
      "resolvedProvider": "kingxliu-openai",
      "reasoningEffort": "high"
    }
  }
}
```

可选字段（每个 role 可设）：
- `primaryModel`：`provider/model` 格式
- `fallbackModels`：失败时回退（按顺序尝试）
- `resolvedProvider`：显式指定 provider（用于 `provider/model` 里 provider 是别名时消歧）
- `reasoningEffort`: `"low"` / `"medium"` / `"high"`（仅对支持 reasoning 的模型有效）
- `reasoningSummary`: 同上
- `serviceTier`: `"default"` / `"flex"` / `"priority"`（OpenAI）

---

## 常见踩坑

### 把同一个模型赋给全部 role

能跑，但成本和速度都不优。最常见的错配：
- 全用 Opus → 贵 3-5 倍，drafter/outline 场景用不上它的推理
- 全用 Haiku/MiniMax → catalog/reviewer 会出现目录划分不合理、引用错配漏掉

### drafter 用 GPT-5.4 级别模型

极浪费。drafter 是 token 大户但主要工作是"按 outline 写 + tool-calling 搜证据"，中型模型足够。把预算省下来给 reviewer 更划算。

### reviewer 用没 reasoning 能力的模型

strict 模式下 reviewer 要判断 "正文是否覆盖了 outline 承诺的 mechanism"，没 reasoning 很容易漏判，结果就是 coverage 假通过、最终页面堆证据但论点空。

### catalog 失败时用同一个模型 retry 3 次

设计上就是这样（`fallbackModels: []` 时）。如果上游 provider 在某个时间段不稳，可以在 `fallbackModels` 列一个同档备用，比如 `["openai/gpt-5.4", "anthropic/claude-sonnet-4-7"]`。

---

## 未来会加的 role

- `researcher`（ask 模式下的深度研究 agent）— 目前复用 `drafter` 配置
- `embedder`（向量索引生成）— 目前不启用
