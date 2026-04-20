# Contributing to RepoRead

欢迎 PR。本文覆盖提交代码前需要知道的最小集。

## 开发环境

```bash
pnpm install
pnpm -r run build
pnpm --filter @reporead/core test    # 核心包单测
```

本仓库是 **pnpm workspace**，三个 package：

| package | 作用 |
| --- | --- |
| `@reporead/core` | Agent、pipeline、provider、工具运行时 |
| `@reporead/cli`  | `repo-read` 命令入口（TSX + ink） |
| `@reporead/web`  | Next.js 阅读器前端 |

下手之前建议先读 [`docs/design.md`](./docs/design.md) 了解模块边界，再看 [`docs/design-rationale.md`](./docs/design-rationale.md) 知道为什么这么设计——避免重复提已被评估过的替代方案。

## 工作流

1. 从 `main` 起新分支（或 fork）
2. **TDD**：先写失败的测试，再实现；参考已有 `__tests__/` 目录
3. 本地全绿后再提交：

```bash
pnpm --filter @reporead/core test    # 必须全绿
pnpm --filter @reporead/core build   # tsc 无错
pnpm --filter @reporead/cli  build
```

4. 提 PR，描述带上：
   - 改动的动机（which problem / which observation）
   - 影响范围（哪个 package、哪条 pipeline 链路）
   - 如果改了配置/API：列出兼容性影响

## Commit 信息

沿用 conventional 前缀 + 一句话描述：

```
fix(drafter): detect empty output instead of silently passing
feat(providers): model-level rate limits with provider-level fallback
perf(review): suppress attempt-based L2 escalation on terminal attempt
docs: reorganize into user-facing open-source layout
```

常用 scope：`drafter / reviewer / coverage / providers / rate-limiter / pipeline / cli / web / docs`。

## 测试期望

- 任何改动都要跑 `pnpm --filter @reporead/core test` 确认 `Tests N passed (N)`
- 新增模块请给 `__tests__/<module>.test.ts`，回归测试覆盖真实触发过的 bug
- 不要给通过 mock 绕过错误路径——已观察到的错误必须被测试覆盖

## 本地手动验证

大的 pipeline 改动建议在小仓上 e2e 一次：

```bash
cd /path/to/small/target
repo-read init
repo-read generate -d . --page-concurrency 1
```

`--page-concurrency 1` 能把日志顺序稳住便于调试。

## 开发记录

不要把 session plans / specs / reviews 提交到 git，统一放 `dev-notes/`（已在 `.gitignore` 中）。`docs/` 只放对外的 canonical 文档。

## Issue / Bug

附带复现仓库路径、使用的 preset、pc、provider、以及日志里相关段落。如果看到 hang：

```bash
kill -USR1 <pid>    # 会在 <jobDir>/hang-dump-<ts>.json 写一份 active resources 快照
```

把 dump 粘进 issue。

## License

所有贡献默认以 [MIT](./LICENSE) 授权。
