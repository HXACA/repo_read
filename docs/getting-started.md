# 快速上手

本文带你从零把 RepoRead 跑起来，最终在浏览器里读到为某个目标仓库生成的 wiki。

## 前置条件

- **Node.js 18+**（推荐 20 LTS）
- **pnpm 8+**（本仓库是 pnpm workspace）
- **一个支持 streaming tool-call 的 OpenAI-compatible API key**
  - 官方支持：Anthropic（Claude）、OpenAI（GPT-5+）
  - 社区/代理：kingxliu、OpenRouter、以及任何实现了 `/v1/chat/completions` 或 `/v1/responses` 的服务
  - 本地模型（Ollama 等）可用 `local-only` preset，但质量和稳定性取决于你本地模型对 tool-call 的支持度

## 安装

```bash
git clone https://github.com/YOUR_ORG/repo_read.git
cd repo_read
pnpm install
pnpm --filter @reporead/core run build
pnpm --filter @reporead/cli  run build
pnpm --filter @reporead/web  run build
```

构建产物：

- `packages/cli/dist/` — CLI 入口（`repo-read` 可执行脚本）
- `packages/core/dist/` — 核心运行时
- `packages/web/.next/` — Wiki 阅读器前端

把 CLI 链接到 PATH（可选）：

```bash
pnpm --filter @reporead/cli exec npm link
# 之后就能直接 `repo-read --help`
```

如果不 link，也可以直接用 `pnpm --filter @reporead/cli exec repo-read ...` 调用。

## 一次配置：写全局配置文件

RepoRead 的配置是**两层 merge**：全局（`~/.reporead/config.json`）放 API key 和默认模型，项目级（`<repo>/.reporead/projects/<slug>/config.json`）放覆盖。

第一次只需要写全局配置：

```bash
mkdir -p ~/.reporead
cat > ~/.reporead/config.json << 'EOF'
{
  "language": "zh",
  "providers": [
    {
      "provider": "openai",
      "npm": "@ai-sdk/openai",
      "secretRef": "OPENAI_API_KEY",
      "apiKey": "sk-...",
      "enabled": true
    }
  ],
  "roles": {
    "catalog":  { "model": "openai/gpt-5",      "fallback_models": [] },
    "outline":  { "model": "openai/gpt-5",      "fallback_models": [] },
    "drafter":  { "model": "openai/gpt-5",      "fallback_models": [] },
    "worker":   { "model": "openai/gpt-5-mini", "fallback_models": [] },
    "reviewer": { "model": "openai/gpt-5",      "fallback_models": [] }
  }
}
EOF
```

换成 Anthropic：把 `provider` 改成 `"anthropic"`、`npm` 改成 `"@ai-sdk/anthropic"`、`secretRef` 改成 `"ANTHROPIC_API_KEY"`，model ID 换成 `anthropic/claude-sonnet-4-6` 即可。

换成 kingxliu 或其他 OpenAI-compatible 代理：`npm` 用 `"@ai-sdk/openai-compatible"` 并加 `"baseUrl": "https://..."` 字段。kingxliu 的 Token Plan 有账号级并发上限，建议同时设 `rateLimit`，见 [configuration.md](./configuration.md)。

## 跑通三步：init → generate → browse

找一个**不太大的** git 仓库做第一个目标，比如一个 npm 包或者你自己的小工具仓（几十到几百个文件最合适）。

```bash
cd /path/to/your/target/repo

# 1. 初始化项目配置（在 <repo>/.reporead/projects/<slug>/ 下创建项目元数据）
repo-read init

# 2. 生成 wiki（首次会跑 catalog → outline → 逐页 drafter/reviewer/validator → publish）
repo-read generate -d .

# 3. 在浏览器里读
repo-read browse -d .
# 默认打开 http://localhost:3000
```

## 预期输出

以一个 `~200 文件的 Node 模块`为例，跑 `balanced` preset（默认）：

- **catalog 阶段**：约 1-2 分钟，产出 `wiki.json`，包含一个严格顺序的 `reading_order`（通常 8-15 页）
- **page 阶段**：每页约 1-3 分钟（取决于页面覆盖文件数与 reviewer 要补证据的轮数）
- **落盘位置**：`<repo>/.reporead/projects/<slug>/versions/<timestamp>/` 下是每一版的 Markdown + 引用索引
- **浏览器里**：左侧目录按 `reading_order` 排列；每页正文里的引用都能点开回跳到源文件具体行

如果中途失败或想重跑，用 `repo-read jobs -d .` 查历史 job，再 `repo-read generate --resume <jobId>` 续跑。

## 接下来

- 调 preset / 模型 / rateLimit → 看 [configuration.md](./configuration.md)
- 所有命令 flags 完整列表 → 看 [cli-reference.md](./cli-reference.md)
- 对着 wiki 提问 → `repo-read ask -d .`
- 对着代码做深度 research → `repo-read research -d . -t "some topic"`
