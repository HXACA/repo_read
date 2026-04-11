# CLI 进度面板设计

> Date: 2026-04-11
> Status: Approved
> Scope: `packages/cli/src/progress-renderer.ts` + `packages/cli/src/commands/generate.tsx`

## 概述

`repo-read generate` 命令的实时进度面板。全量章节列表常驻终端，每秒原地刷新，显示所有章节的完成状态、当前章节的子步骤进展、整体进度条和 ETA。

## 布局

### 正常生成

```
repo-read generate

  ✓ Catalog: 20 pages · 5 sections                              8s

  ── 入门指南 ──────────────────────────────────────────────────────
  ✓  1. 项目概述与核心功能                                      45s
  ✓  2. 快速启动与部署指南                         [2 attempts] 2m30s
  ✓  3. 项目目录结构与模块划分                                 1m15s
  ── 核心架构 ──────────────────────────────────────────────────────
  ✓  4. 后端入口与应用初始化                                   3m20s
  ✓  5. 配置系统与多提供商管理                     [3 attempts] 5m10s
  →  6. RAG 检索增强生成                                       2m15s
       evidence: 12 citations → outline: 5 sections → reviewing...
  ○  7. 数据处理管道
  ○  8. 嵌入模型与向量存储
  ── 前端应用 ──────────────────────────────────────────────────────
  ○  9. 前端应用架构
  ○ 10. Wiki 展示页面
  ...
  ── 部署指南 ──────────────────────────────────────────────────────
  ○ 18. Docker 容器化部署
  ○ 19. 文件过滤配置
  ○ 20. 认证与授权

  ▓▓▓▓▓▓░░░░░░░░░░░░░░ 5/20 25% · 12m32s elapsed · ~38m left
```

### Resume 场景

```
repo-read generate --resume 8de7...

  ⊘ 1-9 已完成（上次运行），跳过

  ── 核心架构 ──────────────────────────────────────────────────────
  ✓ 10. 聊天流式响应与 WebSocket                              4m30s
  → 11. 提示词模板系统                                        2m15s
       evidence: 8 citations → drafting...
  ○ 12. DeepResearch 深度研究
  ── 前端应用 ──────────────────────────────────────────────────────
  ○ 13. 前端应用架构
  ...

  ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░ 10/20 50% · 4m30s elapsed · ~4m left
```

### 完成状态

```
  ✓ Generation complete!
    Version:  2026-04-10-223926
    Pages:    20/20
    Elapsed:  1h15m
    Avg/page: 3m45s
```

### 失败状态

```
  ✗ Generation failed
    Job:     8de7581e-...
    Elapsed: 45m
    Resume:  repo-read generate --resume 8de7581e-...
```

## 渲染规则

| 元素 | 规则 |
|---|---|
| Section 分隔线 | 从 wiki.json `reading_order[].section` 渲染。每个新 section 显示 `── name ────...`。相邻页面 section 相同则不重复 |
| ✓ 已完成 | 序号 + 标题 + `[N attempts]`（仅 >1 时）+ 耗时右对齐 |
| → 当前 | 序号 + 标题 + 实时耗时，下方展开子步骤链 |
| ○ 待写 | 序号 + 标题，ANSI dim（`\x1b[2m`）灰显 |
| ⊘ 跳过 | resume 时折叠成一行：`⊘ 1-N 已完成（上次运行），跳过` |
| 进度条 | 底部，`▓` + `░` 共 20 格 + completed/total + 百分比 + elapsed + ETA |
| Catalog 行 | catalog 完成后显示页数和 section 数，catalog 进行中显示 `◦ Cataloging...` |

## 子步骤链

当前章节（→）下方展开一行，格式为 `→` 连接的已完成阶段链 + 当前阶段：

```
evidence: 12 citations → outline: 5 sections → drafting...
evidence: 12 citations → outline: 5 sections → reviewing...
evidence: 12 citations → outline: 5 sections → revise #2 → drafting...
```

各阶段：
- `evidence: N citations` — page.evidence_collected 事件
- `outline: N sections` — outline planner 完成（推断自 page.drafting 事件，因为 outline 没有独立事件）
- `drafting...` / `reviewing...` — page.drafting / page.drafted 事件
- `revise #N` — page.reviewed verdict=revise 时插入

## 数据来源

| 数据 | 来源 |
|---|---|
| 章节列表 + section + title | `wiki.json.reading_order`，catalog 完成后获取 or resume 时传入 |
| 实时状态变更 | `PipelineRunOptions.onEvent` 回调 |
| 页面耗时 | renderer 内部 `Date.now()` 差值 |
| 总计时 | renderer `startedAt` 到当前时间 |
| ETA | 已完成页面平均耗时 × 剩余页数 |

## 技术方案

- **无第三方依赖**：纯 ANSI escape codes (`\x1b[A` 上移光标，`\x1b[2K` 清行，`\x1b[2m` dim)
- **单一 class**：`ProgressRenderer`，持有 `PageDisplayState[]` 数组（全量页面状态）
- **双驱动刷新**：
  - `setInterval(1000)` — 时间刷新（elapsed 每秒跳动）
  - `onEvent()` — 状态变更刷新
- **输出到 stderr** — 不干扰 stdout pipe
- **全量重绘** — 每次 render 先清掉上次写的所有行，再全量输出。行数 = section 分隔线 + 页面行数 + 子步骤行 + 进度条行 + 空行

## 接口

```typescript
class ProgressRenderer {
  // 初始化
  setPageList(pages: Array<{ slug: string; title: string; section?: string }>): void;
  setResumeSkipped(n: number): void;
  start(): void;   // 启动 1s 定时器
  stop(): void;    // 停止定时器

  // Pipeline 事件回调
  readonly onEvent: (event: AppEvent) => void;

  // 结束
  printSummary(success: boolean, job: JobInfo): void;
}
```

## 不做的事

- 不用 ink/react/blessed 等 TUI 框架
- 不做终端宽度自适应（假设 ≥80 列）
- 不做颜色主题配置
- 子步骤不单独计时（只计整页耗时）
