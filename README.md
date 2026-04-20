# RepoRead

本地优先的"代码阅读 + 技术写作"工作台。把任何 git 仓库变成一本可以逐页阅读、可以直接提问、可以做深度 research 的技术 wiki。

## 能干什么

- **给任意 git 仓库生成可读的技术 wiki**：catalog 产出严格阅读顺序，逐页生成正文 + 引用，自带审稿与校验
- **本地优先**：仓库代码不离开你的机器；只有 LLM 推理走模型 API（所有写作、检索、验证都在本地完成）
- **多 provider**：原生支持 Anthropic、OpenAI，任何 OpenAI-compatible 端点（OpenRouter、kingxliu、自建网关、Ollama）开箱即用
- **质量 / 速度 / 成本可调**：四档 preset（`quality` / `balanced` / `budget` / `local-only`）+ 逐字段 `qualityOverrides`，还有两层 `rateLimit` token bucket 对抗 429
- **内置 ask 与 research**：对着 wiki 提问，答案回链到文件 / 页面 / commit；做深度 research 时区分 `事实 / 推断 / 待确认`

## Quick start

```bash
git clone https://github.com/YOUR_ORG/repo_read.git && cd repo_read
pnpm install && pnpm -r build

# 写 ~/.reporead/config.json（详见 docs/getting-started.md）

cd /path/to/your/repo
repo-read init && repo-read generate -d . && repo-read browse -d .
```

完整上手步骤、配置 JSON 示例、预期输出见 [docs/getting-started.md](./docs/getting-started.md)。

## 架构 at a glance

```
Main Control Loop
  main.author (single LLM orchestrator, 4 modes: catalog | page | ask | research)
    |
    +-- fork.worker   (delegate for parallel in-page evidence collection)
    +-- fresh.reviewer (delegate for independent page review with tool verification)
    |
    Deterministic runtime
    +-- Repo Snapshot / Retrieval tools
    +-- EvidenceCoordinator (plans + runs parallel fork.workers)
    +-- validator (structure / citations / links)
    +-- Publisher (atomic version promotion)
```

设计原则：**单主控 + 两种委派原语 + 确定性 validator**。详见 [docs/architecture.md](./docs/architecture.md)。

## 更多文档

所有文档都在 [docs/](./docs/)，索引见 [docs/README.md](./docs/README.md)：

- [docs/getting-started.md](./docs/getting-started.md) — 从 clone 到生成第一份 wiki
- [docs/configuration.md](./docs/configuration.md) — 配置字段参考 / preset 表 / rateLimit 两层 bucket 语义
- [docs/cli-reference.md](./docs/cli-reference.md) — 所有子命令的 flags 与示例
- [docs/architecture.md](./docs/architecture.md) — Agent 拓扑、工具协议、四个 loop
- [docs/design.md](./docs/design.md) — 工程整体设计
- [docs/design-rationale.md](./docs/design-rationale.md) — 关键决策的取舍记录
- [docs/prd.md](./docs/prd.md) — 产品定位与需求

## Contributing

欢迎 PR。动手之前建议先读 [docs/design.md](./docs/design.md) 了解模块边界，再看 [docs/design-rationale.md](./docs/design-rationale.md) 了解为什么这么设计，避免提出已被评估过的替代方案。

## License

MIT (TODO: add LICENSE file)
