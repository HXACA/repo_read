# RepoRead 文档索引

本目录收敛 RepoRead 的 canonical 文档。历史 plans / specs / reviews 已挪到根目录外部的 `dev-notes/`（git-ignored）。

## 给使用者（End Users）

| 文档 | 用途 |
| --- | --- |
| [getting-started.md](./getting-started.md) | 从 clone 到生成第一份 wiki 的完整上手路径 |
| [configuration.md](./configuration.md) | 全局 / 项目配置文件字段参考，preset 与 rateLimit 语义 |
| [roles-and-model-choice.md](./roles-and-model-choice.md) | 5 个 role 的职责、I/O 规模、推理依赖；三种推荐模型组合 |
| [cli-reference.md](./cli-reference.md) | 所有 `repo-read` 子命令的 flags 与示例 |

## 给贡献者（Contributors）

| 文档 | 用途 |
| --- | --- |
| [architecture.md](./architecture.md) | 运行时 Agent 拓扑、委派原语、工具协议、四个 loop 的权威描述 |
| [design.md](./design.md) | 工程整体设计：模块边界、数据流、落盘格式、状态机；§18 为 V8 增量 |
| [design-rationale.md](./design-rationale.md) | 关键设计决策的取舍记录：为什么这么做、否决了哪些替代方案 |
| [prd.md](./prd.md) | 产品需求与主线定位，回答"RepoRead 要解决什么问题" |

## 给维护者

| 文档 | 用途 |
| --- | --- |
| [releasing.md](./releasing.md) | 把 @reporead/core + @reporead/cli 发到 npm 的完整流程 |
