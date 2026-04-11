# RepoRead 架构优化方案

> 时间：2026-04-12
> 来源：feature/zread 分支完整 review + 开发过程复盘
> 状态：待评审
> 测试基线：318 pass / 0 fail

---

## 0. 核心原则

本次优化围绕两条主线：

1. **速度**：减少不必要的 LLM 调用、避免重复计算、利用并行
2. **质量**：让 reviewer 真正验证而非表演、让 pipeline 的每一步都可观测和可复用

一条贯穿的设计理念：**上下文拆分 + 结果复用**。大段上下文塞给模型不如按需披露 + 持久化中间结果。人类 reviewer 看过一遍后不会重新看全文，而是关注上次标注的问题是否修复——pipeline 也应该如此。

---

## 1. 速度优化

### S-1. 消除重复 `profileRepo` 调用
| 优先级 | 预估 |
|---|---|
| 高 | 30min |

**问题**：`generate.tsx` 调一次打印日志，`generation-pipeline.ts` 再调一次给 catalog planner。两次完整的文件系统遍历。

**方案**：`PipelineRunOptions` 增加 `repoProfile?: RepoProfile`，CLI 传入已有的 profile。

### S-2. ForkWorker 缺少 `maxSteps` 约束
| 优先级 | 预估 |
|---|---|
| 高 | 30min |

**问题**：所有其他 agent 都有 step 预算，唯一没有的是 ForkWorker。quality 预设下 3 个并行 worker，任意一个跑飞就阻塞整个页面。

**方案**：`QualityProfile` 增加 `workerMaxSteps`（quality=8 / balanced=6 / budget=4），ForkWorker 构造时传入。

### S-3. Evidence 重试时全量重跑 → 增量补充
| 优先级 | 预估 |
|---|---|
| 中 | 4h |

**问题**：reviewer 报 `factual_risks` 后，pipeline 重跑整个 evidence coordinator（重新规划 + 全部 worker 重跑），即使只有一个子领域需要补充。

**方案**：
- coordinator.collect() 接受 `existingLedger` 参数
- 只为 reviewer 标注的领域派新 worker
- 新结果 merge 进现有 ledger，不替换

### S-4. Drafter/Reviewer/Coordinator 逐页重建 → 循环外创建
| 优先级 | 预估 |
|---|---|
| 低 | 15min |

**问题**：这些对象是无状态的（只持有 model + config），但每页都 new 一次。

**方案**：page loop 外创建一次，循环内复用。

### S-5. 跨页 evidence 复用
| 优先级 | 预估 |
|---|---|
| 低 | 6h |

**问题**：多个页面共享 `covered_files` 时（同一文件出现在多个页面的 scope 里），worker 重复读取相同文件。

**方案**：维护一个 `Map<filePath, Finding[]>` 作为跨页缓存，worker 执行前先查缓存。

---

## 2. 质量优化

### Q-1. Reviewer 渐进式披露（用户提出）
| 优先级 | 预估 |
|---|---|
| 高 | 4h |

**问题**：当前 reviewer 收到完整 draft（300-500 行）塞在 prompt 里。reviewer "读"的是自己上下文里的文本，不是真正的文件内容。citation 验证是"表演"而非"验证"。

**方案**：
1. Draft 已经落盘到 `.reporead/.../pages/<slug>.md`
2. `ReviewBriefing` 去掉 `current_draft` 字段，改为 `draft_file_path: string`
3. Reviewer prompt 改为：先用 `read` 工具读 draft 文件，再用 `read` 验证 citations 指向的源码
4. 这样 reviewer 的 citation 验证是真正的——它读了源文件，对比了 draft 的声明
5. `quality` / `strict` 预设使用此模式；`balanced` / `budget` 保持 in-context 模式（节省 tool call）
6. reviewer 步数预算从 15 调到 25（多了读文件的开销）

### Q-2. Reviewer 复用上次结果（用户提出）
| 优先级 | 预估 |
|---|---|
| 高 | 3h |

**问题**：revision 循环中，每次 review 都是从零开始完整审阅。人类 reviewer 第二次看的时候只关注上次标注的问题是否修复了，不会重新看全文。

**方案**：
1. 第一次 review → 完整审阅，结果持久化到 `.reporead/.../review/<slug>.review.json`（已有）
2. 后续 review（revision attempt > 0）→ prompt 改为：
   ```
   上次审阅发现以下问题：
   - blocker: [具体问题]
   - factual_risk: [具体问题]
   
   作者已修订了 draft。请重点检查以上问题是否修复。
   如果全部修复，verdict=pass。如果仍有问题，列出剩余问题。
   ```
3. 这样 reviewer 的 context 更小、更聚焦，verdict 更准确
4. 持久化的 review 结果可以跨 resume 复用——resume 后不需要从零审阅已有 review 的页面

### Q-3. 跨页一致性检查
| 优先级 | 预估 |
|---|---|
| 中 | 1h |

**问题**：reviewer 不知道前面页面写了什么，无法发现重复内容或矛盾声明。

**方案**：`ReviewBriefing` 增加 `publishedSummaries` 字段，reviewer prompt 增加检查项："这个页面是否与已发布页面有重复或矛盾？"

### Q-4. Drafter prompt 增加反面模式指导
| 优先级 | 预估 |
|---|---|
| 低 | 15min |

**问题**：LLM 常见写作问题——"Let's dive in"、"In this section we learned"、过度列表化。

**方案**：system prompt 追加 "Do NOT" 段落：
```
Do NOT:
- Use "Let's dive in/explore/take a look" openings
- Add summary paragraphs at the end of sections
- Convert every paragraph into bullet lists
- Use hedging phrases like "It's worth noting" or "Interestingly"
```

### Q-5. relatedPages 确定性计算
| 优先级 | 预估 |
|---|---|
| 低 | 1h |

**问题**：`relatedPages` 依赖 draft 里的 `[cite:page:slug]` 标记，经常为空。

**方案**：pipeline 在 validate 阶段，根据 `wiki.json` 的 `covered_files` 交集自动计算 related pages，merge 进 pageMeta。

### Q-6. 确定性 citation 密度检查
| 优先级 | 预估 |
|---|---|
| 低 | 2h |

**问题**：validation 只做结构检查，不检查 citation 密度。零引用的 section 不会被标记。

**方案**：`page-validator` 增加规则：扫描每个 `##` section，统计 `[cite:` 数量。密度低于阈值的 section 产出 warning（不 block，但记录）。

---

## 3. 架构改进

### A-0. 核心原则：指针传递 + 按需读取（全局适用）
| 优先级 | 预估 |
|---|---|
| 最高 | 贯穿所有优化 |

**原则**：每个 pipeline 阶段的输出都持久化到文件，下一个阶段收到的是**文件路径（指针）**而不是**文件内容**，需要时用工具按需读取。

这不只是 reviewer 的优化，是整个 pipeline 的设计范式转变：

| 阶段 | 现在（全量塞 prompt） | 优化后（指针 + 按需读取） |
|---|---|---|
| Evidence → Drafter | 完整 ledger + findings 塞 prompt | ledger 落盘，outline 指定引用哪些 entry，drafter 按需 read |
| Draft → Reviewer | 完整 draft（300-500 行）塞 prompt | draft 已落盘，reviewer 用 `read` 工具分段阅读 + 验证 |
| Previous Review → Reviewer | 每次从零完整审阅 | 上次 review 持久化，revision 时只检查标注的问题 |
| Previous Draft → Drafter (revision) | 前 4000 字截断塞 prompt | draft 已落盘，drafter 收到路径 + reviewer 标注的具体问题位置 |
| Published Summaries → Drafter | 所有已发布页面 summary 全量塞 | 落盘为索引文件，drafter 用 `PageRead` 按需查引用 |

**好处**：
1. **Context 窗口高效** — 模型只加载需要的信息，不浪费 token 在已知内容上
2. **Resume 更快** — 已有的中间结果直接复用
3. **Debug 可观测** — 每个阶段输入输出都可查文件
4. **模型行为更像人** — 先看概览 → 定位问题 → 深入细节，渐进式披露

### A-1. 中间结果持久化 + 复用体系
| 优先级 | 预估 |
|---|---|
| 高 | 设计层面 |

**核心思路**：pipeline 的每个阶段都应该有持久化的输出，后续阶段可以按需读取而非全量接收。

当前状态：
```
catalog → wiki.json (✅ 已持久化)
evidence → ledger (❌ 只在内存)
outline → PageOutline (❌ 只在内存)
draft → .md 文件 (✅ 已持久化)
review → .review.json (✅ 已持久化)
validation → .validation.json (✅ 已持久化)
```

**方案**：
1. Evidence ledger 持久化到 `<jobDir>/evidence/<pageSlug>.ledger.json`
2. Outline 持久化到 `<jobDir>/outline/<pageSlug>.outline.json`
3. Resume 时可以跳过已有 evidence/outline 的页面的这些阶段
4. Reviewer revision 时可以读取上次 review 结果
5. 跨页 evidence 缓存（S-5）也基于此

好处：
- Resume 更快（不重跑已有的 evidence/outline）
- Debug 更方便（每个阶段的输入输出都可查）
- Reviewer 复用（Q-2）自然实现

### A-2. 配置显式化（已部分完成）
| 优先级 | 预估 |
|---|---|
| 低 | 1h |

**已完成**：`provider/model` 命名 + `npm` 字段
**待完成**：废弃 `inferNpm()` fallback，`npm` 改为必填字段。加一个 config migration 提示。

### A-3. 构建流程规范化
| 优先级 | 预估 |
|---|---|
| 低 | 1h |

**问题**：`repo-read` 命令指向 `dist/`，但开发时只改 `src/`，不 rebuild 就不生效。这导致了整个 session 的改动都没生效的严重问题。

**方案**：
- `package.json` 的 `bin` 改为指向 tsx 运行的入口（开发时）
- 或增加 `pnpm dev` 命令用 tsx 实时运行
- CI/发布时才 build 到 dist

---

## 4. 设计复盘教训

| 问题 | 教训 |
|---|---|
| 进度面板 10+ 次重写 | 终端渲染是 solved problem，用框架（Ink），不要手写 ANSI |
| Provider 配置 3 次迭代 | 决定运行时行为的配置必须显式声明，不要推断 |
| Debug 日志 5+ 次迭代 | 在 HTTP 边界插桩，不要在应用层 |
| Schema 吞字段 | 配置加字段时同步更新 Zod schema，加 round-trip 测试 |
| dist 不更新 | 开发用 tsx 直接运行源码，不依赖 tsc build |
| reviewer 结果不复用 | 中间结果应该持久化 + 按需读取，不要全量塞 prompt |

---

## 5. 实施优先级

### 第一批（立即做，2-3h）
1. S-2 ForkWorker maxSteps
2. S-1 消除重复 profileRepo
3. S-4 对象提到循环外
4. Q-4 drafter 反面模式指导

### 第二批（本周，8-10h）
5. Q-1 Reviewer 渐进式披露
6. Q-2 Reviewer 复用上次结果
7. Q-3 跨页一致性检查
8. A-1 evidence/outline 持久化

### 第三批（后续迭代）
9. S-3 增量 evidence 补充
10. S-5 跨页 evidence 缓存
11. Q-5 relatedPages 确定性计算
12. Q-6 确定性 citation 密度检查
13. A-2 废弃 inferNpm
14. A-3 构建流程规范化
