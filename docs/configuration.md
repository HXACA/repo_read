# 配置参考

RepoRead 的配置有两层：

- **全局**：`~/.reporead/config.json` — 放账号级凭据、默认模型路由、默认语言
- **项目**：`<repo>/.reporead/projects/<slug>/config.json` — 放当前仓库的覆盖项（preset、模型、语言等）

## Merge 规则

运行时加载顺序：先读全局，再读项目，项目字段**覆盖**全局。Provider 列表按 `provider` 名做 key 合并：

- 项目里 **列出** 的 provider 会替换全局同名 provider 的 `npm` / `enabled` / `models` / `rateLimit` 字段
- **例外**：`apiKey`、`baseUrl`、`secretRef` 若在项目里缺失，会从全局同名 provider 补上（这是有意为之——不想在每个项目 config 里重复粘贴 key）
- 项目里**没有**列出的 provider 按全局原样保留

`roles` 字段是整体替换（不是深 merge）；若项目给了 `roles`，以项目为准，全局 `roles` 失效。

## 顶层字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectSlug` | string | 项目级必填 | 项目唯一标识，决定 `.reporead/projects/<slug>/` 目录名 |
| `repoRoot` | string | 项目级必填 | 仓库根绝对路径，`init` 自动写入 |
| `preset` | `"quality"` \| `"balanced"` \| `"budget"` \| `"local-only"` | 是 | 质量档位，决定 `QualityProfile` 默认值 |
| `language` | string | 否 | 输出语言，如 `"zh"`、`"en"`。默认 `"zh"` |
| `providers` | `ProviderCredentialConfig[]` | 是 | LLM provider 列表 |
| `roles` | `{ catalog, outline, drafter, worker, reviewer }` | 是 | 角色→模型路由 |
| `qualityOverrides` | `Partial<QualityProfile>` | 否 | 逐字段覆盖 preset 默认值 |

## Provider 字段（`ProviderCredentialConfig`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `provider` | string | Provider 名。必须和 role model ID 的 `<provider>/...` 前缀匹配 |
| `npm` | `"@ai-sdk/anthropic"` \| `"@ai-sdk/openai"` \| `"@ai-sdk/openai-compatible"` | 默认 SDK 包。未设则默认 `"@ai-sdk/openai-compatible"` |
| `secretRef` | string | 环境变量名（如 `"OPENAI_API_KEY"`），doctor 命令会检查其存在性 |
| `apiKey` | string | 可选。直接写 key；若缺失则从 `secretRef` 对应的环境变量取 |
| `baseUrl` | string | 可选。非官方端点时必填（kingxliu、OpenRouter 等） |
| `enabled` | boolean | 是否启用。`false` 时该 provider 及其所有 model 不可用 |
| `models` | `Record<string, ProviderModelConfig>` | 可选。声明该 provider 下具体 model 的参数。若声明，role 只能引用此表中列出的 model |
| `rateLimit` | `ProviderRateLimitConfig` | 可选。**账号级**速率限制，见下文 |

## Model 字段（`ProviderModelConfig`）

以 `providers[n].models[modelId]` 形式声明，比如：

```json
"models": {
  "gpt-5": {
    "reasoningEffort": "medium",
    "reasoningSummary": "auto",
    "rateLimit": { "maxConcurrent": 2, "minIntervalMs": 500 }
  }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 可选。显示名 |
| `npm` | `ProviderSdk` | 覆盖 provider 的默认 SDK（极少用） |
| `variant` | `"responses"` \| `"chat"` | 仅 `@ai-sdk/openai` 用。未设时按 model 名自动判断：gpt-5+ → responses，其余 → chat |
| `reasoningEffort` | `"none"` \| `"minimal"` \| `"low"` \| `"medium"` \| `"high"` \| `"xhigh"` | 思考型模型的推理强度 |
| `reasoningSummary` | `"auto"` \| `"concise"` \| `"detailed"` | 推理摘要返回模式 |
| `serviceTier` | `"fast"` \| `"flex"` | OpenAI 服务档位。`fast` 映射到 `priority`（贵但快），`flex` 可能排队 |
| `rateLimit` | `ProviderRateLimitConfig` | **模型级**速率限制，见下文 |

## rateLimit：两层 token bucket

`ProviderRateLimitConfig` 有两个字段：

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `maxConcurrent` | number | 6 | 同时飞在途的请求上限 |
| `minIntervalMs` | number | 0 | 两次发射之间的最小间隔（ms）。想要 QPS≤2 就填 500 |

**模型级和 provider 级是叠加（不是覆盖）**。当两层都声明时，一个请求必须**同时**拿到模型级 bucket 和 provider 级 bucket 的令牌才能发出。

这个设计面向真实场景，比如 kingxliu 的 Token Plan：

- 账号整体有一个并发/QPS 上限（所有模型共享，超了就 429）
- 某个特定 model（比如 `gpt-5`）自己还想再收紧一点（避免把账号预算打满）

对应配置：

```json
{
  "provider": "kingxliu",
  "npm": "@ai-sdk/openai-compatible",
  "baseUrl": "https://api.kingxliu.example/v1",
  "secretRef": "KINGXLIU_API_KEY",
  "enabled": true,
  "rateLimit": {
    "maxConcurrent": 4,
    "minIntervalMs": 250
  },
  "models": {
    "gpt-5": {
      "reasoningEffort": "medium",
      "rateLimit": {
        "maxConcurrent": 2,
        "minIntervalMs": 500
      }
    },
    "gpt-5-mini": {}
  }
}
```

效果：

- `gpt-5` 的请求要先拿到 gpt-5 bucket（≤2 并发，间隔≥500ms）**再**拿到 kingxliu 全局 bucket（≤4 并发，间隔≥250ms）
- `gpt-5-mini` 没声明自己的 `rateLimit`，只受 kingxliu 全局 bucket 约束
- 整个账号飞在途总数不会超过 4；gpt-5 子集不会超过 2

实测经验：如果你遇到 kingxliu / 类似服务的 429 `rate_limit_exceeded`，优先在 model 级把 `maxConcurrent` 调到 1-2、`minIntervalMs` 调到 500-1000；provider 级再保守兜一层。

## Roles：五个角色的职责

所有角色共享同一个 `main.author` 主控实现，按 mode / 阶段切换。`roles` 字段里每个 key 对应一个**逻辑职责**，运行时挑对应配置：

| Role | 职责（见 [architecture.md](./architecture.md)） |
| --- | --- |
| `catalog` | 读仓库结构，产出严格顺序的 `wiki.json` |
| `outline` | 给每个页面生成 outline，把 evidence ledger 映射到章节 |
| `drafter` | 起草页面正文（main.author 的 page mode） |
| `worker` | `fork.worker` 原语，并行做局部取证 |
| `reviewer` | `fresh.reviewer` 原语，独立会话审稿 + 引用 verify |

每个 role 的配置：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `model` | string | `provider/model` 格式，如 `"openai/gpt-5"` 或 `"anthropic/claude-sonnet-4-6"` |
| `fallback_models` | string[] | 按顺序降级。主模型工具调用失败 / 结构化输出不合格时切换 |
| `reasoningEffort` | 同上 | **角色级**覆盖，优先级高于 model 级 |
| `reasoningSummary` | 同上 | 同上 |
| `serviceTier` | 同上 | 同上 |

典型搭配：`worker` 用便宜快的 model（如 `gpt-5-mini` / `claude-haiku`），`reviewer` 用强 model（审稿要严格）；`drafter` 看你预算。

## Preset 对照表

从 `packages/core/src/config/quality-profile.ts` 提取的真实数值：

| 字段 | `quality` | `balanced` | `budget` | `local-only` |
| --- | --- | --- | --- | --- |
| `forkWorkers` | 3 | 2 | 1 | 1 |
| `forkWorkerConcurrency` | 3 | 2 | 1 | 1 |
| `maxRevisionAttempts` | 3 | 2 | 1 | 1 |
| `maxEvidenceAttempts` | 2 | 2 | 1 | 1 |
| `deepLaneRevisionBonus` | 0 | 0 | 0 | 0 |
| `pageConcurrency` | 3 | 2 | 1 | 1 |
| `coverageEnforcement` | warn | off | off | off |
| `workerMaxSteps` | 50 | 6 | 4 | 4 |
| `catalogMaxSteps` | 100 | 30 | 20 | 20 |
| `drafterMaxSteps` | 100 | 20 | 12 | 12 |
| `reviewerMaxSteps` | 50 | 10 | 6 | 6 |
| `reviewerVerifyMinCitations` | 3 | 2 | 0 | 0 |
| `reviewerStrictness` | strict | normal | lenient | normal |
| `askMaxSteps` | 100 | 10 | 4 | 4 |
| `researchMaxSteps` | 50 | 15 | 8 | 8 |

字段语义速查：

- **forkWorkers / forkWorkerConcurrency** — 每页并行 fork.worker 数 / 并发上限。`1` 时跳过 planner，走 fast path
- **maxRevisionAttempts** — 页面被 reviewer 判 `revise` 后的最大重写次数
- **maxEvidenceAttempts** — 单页 evidence 收集的最大总轮数（含 reviewer 触发的增量 re-run）
- **pageConcurrency** — 同一 job 内可并行推进的页面数，CLI 可用 `--page-concurrency` 覆盖
- **coverageEnforcement** — mechanism 覆盖检查。`off` 不检查；`warn` 观测但不触发重写；`strict` 有缺口就触发 revise
- **drafterMaxSteps / reviewerMaxSteps / workerMaxSteps** — 各角色单次调用的 `stepCountIs(N)` tool-call 预算
- **reviewerVerifyMinCitations** — reviewer 必须用 `read` 工具核查的最小引用数。`0` 关闭强制核查；非 `match` 的核查结果自动升级为 blocker
- **reviewerStrictness** — 注入 reviewer system prompt 的严格度（措辞级）
- **askMaxSteps / researchMaxSteps** — AskStreamService / ResearchService 单次调用的 tool-call 预算

选择建议：

- 正式出版 wiki → `quality`
- 日常迭代 → `balanced`（默认）
- 快速调 prompt / 跑小仓验证 → `budget`
- 跑 Ollama 本地模型 → `local-only`

## qualityOverrides

如果某个 preset 90% 合适但有一两个字段想调，用 `qualityOverrides` 做**逐字段覆盖**，不用换 preset：

```json
{
  "preset": "balanced",
  "qualityOverrides": {
    "pageConcurrency": 1,
    "coverageEnforcement": "strict",
    "reviewerVerifyMinCitations": 3
  }
}
```

`QualityProfile` 上所有字段都可 override；常用的有：

- `pageConcurrency`（1-5）— CLI `--page-concurrency` 优先级更高
- `coverageEnforcement`（`"off"` | `"warn"` | `"strict"`）— CLI `--coverage-enforcement` 优先级更高
- `reviewerVerifyMinCitations`、`reviewerStrictness`、`maxRevisionAttempts`、`forkWorkers` / `forkWorkerConcurrency`
- 各种 `*MaxSteps`（追踪成本炸的时候用）

优先级从低到高：preset 默认值 → `qualityOverrides` → CLI flag。
