# CLI 参考

`repo-read` 是 RepoRead 的统一入口。所有命令都支持 `-d, --dir <path>` 指定目标仓库根（默认 `process.cwd()`），以及 `-n, --name <slug>` 指定项目 slug（默认从项目 config 推断）。

查看全局帮助：

```bash
repo-read --help
```

## `init`

初始化一个新的 RepoRead 项目。在目标仓库根的 `.reporead/projects/<slug>/` 下创建项目配置骨架。

**语法**

```
repo-read init [-d <path>] [-n <slug>]
```

**Flags**

| Flag | 默认值 | 说明 |
| --- | --- | --- |
| `-d, --dir <path>` | `process.cwd()` | 仓库根目录 |
| `-n, --name <slug>` | 从仓库名推断 | 项目 slug |

**示例**

```bash
cd /path/to/target/repo
repo-read init
# 或指定 slug
repo-read init -d /path/to/target/repo -n my-project
```

## `generate`

生成 wiki。首次运行会从 catalog 开始跑完整 pipeline；结合 `--resume` 可续跑失败 job。

**语法**

```
repo-read generate [-d <path>] [-n <slug>] [--resume <jobId>] [--debug]
                   [--incremental] [--page-concurrency <n>]
                   [--coverage-enforcement <mode>]
```

**Flags**

| Flag | 默认值 | 说明 |
| --- | --- | --- |
| `-d, --dir <path>` | `process.cwd()` | 仓库根 |
| `-n, --name <slug>` | 项目 config 里的 slug | 项目 slug |
| `--resume <jobId>` | — | 续跑指定 job；跳过已 validated 的页面 |
| `--debug` | off | 把每次 model 请求/响应对落盘到 `.reporead/debug/`（设环境变量 `REPOREAD_DEBUG=1`） |
| `--incremental` | false | 只重新生成受变更文件影响的页面（**尚未实现**，占位） |
| `--page-concurrency <n>` | preset 默认值 | 同时推进的最大页面数。整数 1-5，超出报错。覆盖 preset 与 `qualityOverrides.pageConcurrency` |
| `--coverage-enforcement <mode>` | preset 默认值 | mechanism 覆盖检查模式。取值 `off` / `warn` / `strict`。覆盖 preset 与 `qualityOverrides.coverageEnforcement` |

**示例**

```bash
# 首次生成
repo-read generate -d .

# 并行跑 3 页，开 debug
repo-read generate -d . --page-concurrency 3 --debug

# 强制覆盖检查
repo-read generate -d . --coverage-enforcement strict

# 续跑上次失败的 job
repo-read jobs -d .            # 先找到 jobId
repo-read generate -d . --resume job_20260418_...
```

## `browse`

在浏览器中打开 wiki 阅读器。启动 Next.js web 服务，自动 load 当前项目的最新已发布版本。

**语法**

```
repo-read browse [-d <path>] [-n <slug>] [-p <port>] [--page <slug>]
```

**Flags**

| Flag | 默认值 | 说明 |
| --- | --- | --- |
| `-d, --dir <path>` | `process.cwd()` | 仓库根 |
| `-n, --name <slug>` | 项目 slug | 项目 slug |
| `-p, --port <port>` | `3000` | web 服务端口 |
| `--page <slug>` | 首页 | 启动后直接跳到某一页 |

**示例**

```bash
repo-read browse -d .
repo-read browse -d . -p 4000 --page architecture-overview
```

## `jobs`

列出项目的历史 generation jobs，含状态、时间、进度。用于找 `--resume` 所需的 jobId。

**语法**

```
repo-read jobs [-d <path>] [-n <slug>]
```

**Flags**

| Flag | 默认值 | 说明 |
| --- | --- | --- |
| `-d, --dir <path>` | `process.cwd()` | 仓库根 |
| `-n, --name <slug>` | 项目 slug | 项目 slug |

**示例**

```bash
repo-read jobs -d .
```

## `versions`

列出项目所有已发布的 wiki 版本。每次 `generate` 成功发布会生成一个新版本。

**语法**

```
repo-read versions [-d <path>] [-n <slug>]
```

**Flags**

| Flag | 默认值 | 说明 |
| --- | --- | --- |
| `-d, --dir <path>` | `process.cwd()` | 仓库根 |
| `-n, --name <slug>` | 项目 slug | 项目 slug |

**示例**

```bash
repo-read versions -d .
```

## `ask`

对着已发布 wiki 提问。默认进交互模式；用 `-q` 传单条问题做一次性问答。

主控走 ask mode：先读当前页和引用、再扩检索。回答必定回链到文件 / 页面 / commit。

**语法**

```
repo-read ask [-d <path>] [-n <slug>] [-p <slug>] [-q <text>]
```

**Flags**

| Flag | 默认值 | 说明 |
| --- | --- | --- |
| `-d, --dir <path>` | `process.cwd()` | 仓库根 |
| `-n, --name <slug>` | 项目 slug | 项目 slug |
| `-p, --page <slug>` | — | 给 ask 带上"当前页"上下文，让回答优先围绕这一页展开 |
| `-q, --question <text>` | — | 非交互模式，单次提问 |

**示例**

```bash
# 交互式
repo-read ask -d .

# 带页面上下文的交互式
repo-read ask -d . -p evidence-coordinator

# 一次性提问
repo-read ask -d . -q "EvidenceCoordinator 如何处理 worker 失败？"
```

## `research`

对某个主题做深度 research。比 `ask` 更重，跑的是 research mode：拆子问题 → 逐个 fork.worker 取证 → 汇总加 `事实 / 推断 / 待确认` 标注。

**语法**

```
repo-read research -t <text> [-d <path>] [-n <slug>]
```

**Flags**

| Flag | 默认值 | 说明 |
| --- | --- | --- |
| `-t, --topic <text>` | — | **必填**。研究主题 |
| `-d, --dir <path>` | `process.cwd()` | 仓库根 |
| `-n, --name <slug>` | 项目 slug | 项目 slug |

**示例**

```bash
repo-read research -d . -t "RepoRead 如何在 reviewer 审稿失败时保证不丢稿"
```

## `doctor`

诊断环境、配置、项目健康度。检查 Node 版本、pnpm 可用性、`secretRef` 对应的环境变量是否设置、项目配置 schema 是否合法、已发布版本是否完整等。**新装 / 配置不 work 时先跑这个**。

**语法**

```
repo-read doctor [-d <path>] [-n <slug>]
```

**Flags**

| Flag | 默认值 | 说明 |
| --- | --- | --- |
| `-d, --dir <path>` | `process.cwd()` | 仓库根 |
| `-n, --name <slug>` | 项目 slug | 项目 slug |

**示例**

```bash
repo-read doctor -d .
```

## `providers`

管理 LLM provider 凭据和角色→模型映射。

**状态**：当前版本尚未实现，执行只打印占位信息。请直接手写 `~/.reporead/config.json` 和项目 config，参考 [configuration.md](./configuration.md)。

**语法**

```
repo-read providers
```
