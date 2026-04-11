# RepoRead 实现差异与后续计划

> 快照时间：2026-04-11
> 版本范围：截至 commit `fc8f386`（feature/zread 分支）
> 前序文档：[implementation-gap-2026-04-10.md](./implementation-gap-2026-04-10.md)
> 关联文档：
> - [产品需求文档](./prd.md)
> - [Agent 架构](./agent-architecture.md)
> - [工程设计文档](./design.md)
> - [CLI 进度面板设计](./superpowers/specs/2026-04-11-cli-progress-panel-design.md)
> - [质量 Review](./quality-review-2026-04-10.md)
>
> 测试状态：285 pass / 0 fail（58 test files）

---

## 0. 自上次 gap 文档以来的新增落地

以下条目在 2026-04-10 gap 文档之后完成，现已标记为"已落地"：

| 编号 | 主题 | commit | 备注 |
|---|---|---|---|
| G-15 | PageDrafter 输出提取鲁棒化 | `0c10fe0` | `stripDraftOutputWrappers()` 剥离 preamble + 外层 fence |
| G-16 | maxOutputTokens + 截断重试 | `0c10fe0` | 默认 16384，finishReason=length → 合成 revise |
| G-17 | 引用密度 → Outline-first 架构 | `5de1ab7` | OutlinePlanner 在 evidence 和 drafting 之间映射引用 |
| G-18 | Catalog section/group 元数据 | `2f20eb6` | `WikiJson.reading_order[].section` + `group` 可选字段 |
| G-19 | Drafter voice 偏 SPEC → documentation | `2f20eb6` | prompt 追加 Writing Voice 段落 |
| G-12 | CLI 进度面板 | `d78acf8` | permanent zone + live zone 方案，事件驱动刷新 |
| — | 确定性 metadata 提取 | `fc8f386` | regex 从 markdown 提取 summary/citations/related_pages，不再依赖 JSON block |
| — | Catalog 去除页数限制 | `60cd11e` | 让模型根据内容自行决定页数 |
| — | 全局配置继承 | `60cd11e` | `~/.reporead/config.json` → `repo-read init` 自动继承 |
| — | Pipeline retry 修复 | `7b36c3b` | verdict=revise 无论 blockers 是否为空都重试 |
| — | Web 侧边栏闪烁修复 | `654c7d3` | useState 同步读 localStorage |
| — | Web Chat 双重文本修复 | `0480d3b` | 不可变 Turn 对象 + AbortController |
| — | browse 自启动 web server | `88f09d4` | 自动拉起 next dev + 等待就绪 |

---

## 1. 里程碑完成度（对照 development-issues.md）

### M0 工程脚手架 — ✅ 完成
B001-B004 全部落地。monorepo + TS strict + Vitest + 三包可运行。

### M1 配置、密钥与 Provider 路由 — ✅ 完成
B010-B016 全部落地。含 Web `/settings/providers` 页面。

### M2 存储、事件与项目模型 — ✅ 完成
B020-B026 全部落地。事件 ndjson + SSE adapter + job-state + Web 项目页。

### M3 Repo Profiler、Catalog — ✅ 核心完成
| ID | 状态 | 说明 |
|---|---|---|
| B030-B034 | ✅ | profiler + ignore + 检索工具 + catalog planner + wiki.json 落盘 |
| B035 | ✅ | catalog 校验（CatalogValidator: 2-50 页限制 + slug 唯一 + covered_files 非空） |
| B036 | ❌ | Catalog Golden Fixtures — 无稳定基线 fixture |

### M4 生成、审稿、校验、发布、恢复 — ✅ 核心完成
| ID | 状态 | 说明 |
|---|---|---|
| B040-B049 | ✅ | 状态机 + page draft + fork.worker + reviewer + validator + publisher + resume + 事件 + 集成测试 |
| B050 | ❌ | 主链路 Golden Fixtures — 无稳定回归基线 |

### M5 Web 基础工作台 — ✅ 核心完成
| ID | 状态 | 说明 |
|---|---|---|
| B060-B065 | ✅ | Provider Center + Generate Workbench + Job 详情 + 版本阅读 + 页面渲染 + Citation Chip |
| B066 | ❌ | 搜索页（page/file/citation 三视图） |
| B067 | ❌ | 版本切换 widget + 最近阅读记录 |
| B068 | ❌ | Web E2E 基线测试 |

### M6 CLI 主链路 — ✅ 核心完成
| ID | 状态 | 说明 |
|---|---|---|
| B070-B072 | ✅ | generate + 进度面板 + browse（含自启 web server） |
| B073 | ❌ | `repo-read doctor` 命令 |
| B074-B075 | ✅ | CLI ask + CLI research |
| B076 | ❌ | CLI 输出 contract 测试 |
| B077 | ✅ | CLI/Web 共享事件消费 |
| B078 | ❌ | CLI 主链路 E2E |

### M7 Ask 问答 — ✅ 核心完成
| ID | 状态 | 说明 |
|---|---|---|
| B080-B084 | ✅ | 路由判定 + session 内存 + 页面检索 + Chat Dock + CLI ask |
| B085 | 🟡 | 集成测试有，但覆盖不全面 |
| B086 | ❌ | "先页面后检索"回归用例 |

### M8 Research 研究 — ✅ 核心完成
| ID | 状态 | 说明 |
|---|---|---|
| B090-B092 | ✅ | 计划生成 + 子问题执行 + 结论落盘 |
| B093 | ❌ | Web Research 工作区 |
| B094 | 🟡 | CLI research 有基本输出但无流式呈现 |
| B095 | 🟡 | 集成测试有，但覆盖不全面 |
| B096 | ❌ | ask/research 边界回归用例 |

### M9 集成验证与发布准备 — ❌ 大部分未开始
| ID | 状态 | 说明 |
|---|---|---|
| B100 | ❌ | Fixture 仓库建设 |
| B101 | ❌ | E2E 主链路 |
| B102 | ❌ | 样例仓库验收模板 |
| B103 | ❌ | 文档回链与入口整理 |
| B104 | ❌ | 发布前 checklist |

---

## 2. 遗留 Gap（从上次文档继承）

### 2.1 P1 级别（功能完善）

| 编号 | 主题 | 位置 | 说明 |
|---|---|---|---|
| G-6 | Ask Session 落盘读取 | `ask/ask-session.ts` | 只有写无读，进程重启后 session 丢失 |
| G-7 | Evidence 智能重规划 | `generation-pipeline.ts` | reviewer 报 factual_risks / scope_violations 时不重新收集 evidence |
| B-1 | Keytar 构建告警 | `secrets/secret-store.ts` | Next.js 构建时 `Can't resolve 'keytar'`，需条件 import |
| B-3 | Reviewer 失败无降级 | `generation-pipeline.ts` | reviewer 调用失败直接 failJob，不降级为 "unverified" 继续 |
| G-9 | `repo-read doctor` 命令 | CLI | 诊断环境 / 配置 / 损坏 jobs / 异常恢复点 |

### 2.2 P2 级别（增强 / 体验）

| 编号 | 主题 | 说明 |
|---|---|---|
| G-8 | Reviewer 会话隔离无代码防护 | 靠 SDK 无状态语义兜底，低风险 |
| G-10 | Web 全库搜索页 | page/file/citation 三视图 |
| G-11 | Web 版本切换 widget | 快速回到最近阅读页面 |
| G-13 | SystemPromptTuningProfile | 按模型族分 prompt 前缀 |
| G-14 | Interrupt 语义 | 主动中断 → 保存 → 可 resume |
| G-20 | relatedPages 经常为空 | reviewer 未检查关联页面数 |
| D-1~D-4 | 代码超前文档 | evidence 降级策略、revisionAttempts、resumeWith、commit citation 均未反写 |
| B-4 | backlog/issues 文档过期 | 停留在 2026-04-08 |

### 2.3 已知 Bug

| 编号 | 主题 | 说明 |
|---|---|---|
| B-2 | Resume 不重新评估 preset | 用户改 preset 后 resume，新旧页面质量标准不一致 |
| NEW-1 | Web hydration mismatch | `makeHeadingIdFactory` server/client 生成不同 ID |

---

## 3. 新发现的 Gap（本次 Review）

### 3.1 CLI 进度面板 vs 设计 spec 的偏差

设计 spec（`2026-04-11-cli-progress-panel-design.md`）定义了全量章节列表原地刷新方案。当前实现（`d78acf8`）采用了"permanent zone + live zone"的折中方案：

| 设计 spec 要求 | 当前实现 | 偏差 |
|---|---|---|
| 全量章节列表原地刷新 | 章节列表打印一次（permanent），只刷新 1-2 行 live zone | 已完成章节的 ✓ 标记出现在列表下方而非原位更新 |
| 每章节实时状态 ✓/→/○ | ○ 列表打印后不更新，✓ 在下方新增 | 功能可用但视觉不如 spec 理想 |
| 子步骤链格式 `evidence: 12 citations → outline → drafting...` | `12条引用 → 大纲 → 撰写中` 中文标签 | 格式略有不同但信息等价 |

**评估**：当前方案在各终端下稳定工作（经历 8+ 次迭代验证），全量刷新方案在某些终端有闪烁问题。建议保持现状，标记 spec 已偏差。

### 3.2 测试覆盖缺口

| 包 | 测试文件数 | 说明 |
|---|---|---|
| core | 55 | 覆盖主要模块 |
| cli | 3 | 仅 init/generate/cli 结构，缺 browse/ask/research/progress-renderer 测试 |
| web | 0 | 无测试 |

### 3.3 E2E / Golden Fixture 空白

B036（Catalog Golden）、B050（Pipeline Golden）、B078（CLI E2E）、B101（全链路 E2E）均未开始。目前质量验证完全依赖真实跑一遍 + 人工审查。

---

## 4. 后续实施计划

按优先级分三个阶段。每阶段结束后可独立发布。

### Phase A: 质量加固（发布前必做）

目标：确保主链路稳定可靠，消除已知阻塞性问题。

| 序号 | 任务 | 对应编号 | 预估 | 说明 |
|---|---|---|---|---|
| A-1 | Reviewer 失败降级 | B-3 | 3h | reviewer 异常时落盘 "unverified" review，pipeline 继续；resume 时优先重跑 |
| A-2 | Keytar 构建告警修复 | B-1 | 1h | `secret-store.ts` 改动态 import + 条件守卫 |
| A-3 | Web hydration mismatch | NEW-1 | 2h | `makeHeadingIdFactory` 确保 server/client 一致 |
| A-4 | CLI 缺失测试补齐 | — | 3h | browse/ask/research/progress-renderer 基本单测 |
| A-5 | 修复 stale test | — | ✅ 已完成 | catalog-prompt.test.ts 已更新 |

### Phase B: 功能完善（V1 强相关）

目标：补齐设计文档中 P1 级别的功能缺失。

| 序号 | 任务 | 对应编号 | 预估 | 说明 |
|---|---|---|---|---|
| B-1 | Ask Session 落盘读取 | G-6 | 2h | `AskSessionManager.loadFromDisk()` + `list()`，进程重启后可继续对话 |
| B-2 | Evidence 智能重规划 | G-7 | 4h | reviewer 的 factual_risks/scope_violations 也触发 re-collect |
| B-3 | `repo-read doctor` 命令 | G-9 | 3h | 检查环境 / 配置 / 不可用模型 / 损坏 jobs |
| B-4 | CLI E2E 测试 | B078 | 4h | `init → generate → resume → browse` 全链路 mock 测试 |
| B-5 | Pipeline Golden Fixtures | B050 | 3h | 至少一个 fixture 仓库的主链路回归 |
| B-6 | Ask/Research 回归用例 | B086+B096 | 3h | page-first 不误入 research + 复杂问题可升级 |

### Phase C: 体验增强（V1 后迭代）

目标：提升用户体验和系统完整度，非发布阻塞。

| 序号 | 任务 | 对应编号 | 说明 |
|---|---|---|---|
| C-1 | Web 搜索页 | G-10 / B066 | page/file/citation 三视图搜索 |
| C-2 | Web 版本切换 widget | G-11 / B067 | 版本列表 + 最近阅读 |
| C-3 | Web Research 工作区 | B093 | 研究计划/进度/结论 UI |
| C-4 | Web E2E 测试 | B068 | 四类核心页面的 E2E |
| C-5 | SystemPromptTuningProfile | G-13 | 按模型族调优 prompt 前缀 |
| C-6 | Interrupt 语义 | G-14 | 主动中断 → 保存 → 可 resume |
| C-7 | relatedPages 改善 | G-20 | reviewer 检查关联页面数 ≥2 |
| C-8 | 文档回写 | D-1~D-4 + B-4 | 代码超前文档的反写 + backlog 更新 |
| C-9 | Fixture 仓库建设 | B100 | 五类 fixture 仓库 |
| C-10 | 发布前 checklist | B104 | 发布阻断项清单固化 |

---

## 5. 量化摘要

| 维度 | 数量 |
|---|---|
| 里程碑（M0-M9） | 10 个 |
| 里程碑完成度 | M0-M4 ✅，M5-M8 核心完成，M9 未开始 |
| Issue 总量（B001-B104） | 62 个 |
| 已完成 | ~48 个（77%） |
| P1 剩余 | 6 个（Phase B） |
| P2 剩余 | ~10 个（Phase C） |
| 测试总数 | 285 pass / 0 fail |
| 测试文件 | 58 个 |
| 核心代码文件 | ~146 个 |
| 已验证仓库 | deepwiki-open（GLM-5.1, 92/100）、hermes-agent（进行中） |

---

## 6. 建议下一步

1. **如果目标是尽快发布 V1**：执行 Phase A（~9h），然后 Phase B 中的 B-1/B-3/B-4（~9h），总计约 18h 工作量。
2. **如果目标是继续验证质量**：等 hermes-agent 生成完成 → 质量评估 → 发现新问题再修。
3. **如果目标是扩大模型覆盖**：优先做 C-5（SystemPromptTuningProfile），支持 GLM/Claude/GPT 不同 prompt 策略。

建议路径：**A → B-1/B-3/B-4 → 发布 V1 → C 系列按需迭代**。
