# RepoRead 提效优先的架构演进文档

> 时间：2026-04-14  
> 状态：下一阶段架构指引  
> 前提：P0-P5 runtime 重构已完成  
> 关联文档：
> - [docs/coding-agent-design-comparison-2026-04-13.md](./coding-agent-design-comparison-2026-04-13.md)
> - [docs/runtime-refactor-blueprint-2026-04-13.md](./runtime-refactor-blueprint-2026-04-13.md)
> - [docs/architecture-optimization-2026-04-12.md](./architecture-optimization-2026-04-12.md)

---

## 0. 这份文档回答什么问题

P0-P5 解决的是一个根问题：

> RepoRead 不能再由业务流程层代管 runtime。

这个问题现在已经解决。下一阶段不该继续把精力花在“分层是否正确”上，而应该转向另一个更直接的问题：

> 在文档质量已经基本可接受的前提下，如何显著提升整体生成效率。

这份文档不讨论三类方向：

1. 通用 coding agent 平台化
2. memory / compaction / replay 系统
3. MCP / plugin / protocol 扩张

原因很简单：RepoRead 是一个垂类项目，它的核心价值不是“通用代理能力”，而是“高质量代码文档生成效率”。

所以这里的目标不是把 RepoRead 做成第五个通用 agent，而是把它做成：

> 一个有 agent 能力的文档编译系统。

---

## 1. 当前阶段的判断

### 1.1 已经完成的事

P0-P5 完成后，RepoRead 现在已经具备了继续演进的基础：

1. `TurnEngine` 已经从业务层剥离
2. `PromptAssembler` 已经是统一入口
3. `ArtifactStore` 已经覆盖 generation 主链 artifact IO
4. `ConversationContextManager` 已经替代 ask 里的硬编码 turn slicing
5. `GenerationPipeline.run()` 已经退化为业务编排器，而不是半个 runtime

这意味着后续优化可以建立在稳定控制平面上，而不是继续在 `generation-pipeline.ts` 里打补丁。

### 1.2 当前真正的瓶颈

在“质量基本 OK，效率偏低”的前提下，瓶颈通常不是 prompt 文案本身，而是执行成本结构。

RepoRead 当前的效率损耗主要来自四个方向：

1. **强顺序主链**
   - 当前 page workflow 仍然偏串行
   - `evidence -> outline -> draft -> review -> revise` 是高成本长链

2. **高成本步骤没有分层**
   - 并不是所有页面都值得跑同样强度的 planner / worker / reviewer
   - 当前仍偏“所有页默认走重流程”

3. **证据与中间结果复用不足**
   - 不同页面会重复读取相似代码、重复整理相似证据
   - page 之间的共用信息还没有成为正式的共享层

4. **review 成本过高**
   - reviewer 仍然是最贵阶段之一
   - 如果 revision 后继续全量重审，成本会被放大

一句话总结：

> RepoRead 下一阶段最重要的事情，不是变得更通用，而是变得更像一套高吞吐、分层验证、可复用的文档生成流水线。

---

## 2. 战略边界

为了避免重新走向“能力越长越散”，下一阶段先明确边界。

### 2.1 明确不做的事

下一阶段不优先做：

1. Prompt OS 平台化
2. 统一 memory 系统
3. MCP / plugin / protocol 扩张
4. 用户可编排的开放式 subagent 框架
5. 通用 coding shell 化

这些方向不是永远不做，而是当前 ROI 不高。

### 2.2 明确要做的事

下一阶段只围绕四个词：

1. **并行**
2. **升级**
3. **复用**
4. **增量**

也就是：

1. 让不需要串行的步骤尽量并行
2. 让高成本角色只在需要时升级
3. 让证据和中间结果可复用
4. 让变更后的重生成尽量增量化

---

## 3. 和四个 agent 的差距，按你的约束重排

在“不泛化、不做 memory/MCP、优先提效”的前提下，RepoRead 和四个 agent 的差距不再是“平台能力面”，而是**执行控制方式**。

### 3.1 最值得借的东西

#### 从 Claude Code 借

借的是：

1. 统一 query runtime 背后的执行控制意识
2. 对高成本步骤做集中治理
3. 工具与模型调用的调度感

不借的是：

1. 通用 chat-first 形态
2. 大规模上下文压缩体系

#### 从 Codex 借

借的是：

1. 清晰的控制平面边界
2. 显式的请求层级
3. 把策略对象化，而不是 if/else 堆叠

不借的是：

1. 通用 instruction stack 扩张
2. 大而全的 agent shell

#### 从 OpenCode 借

借的是：

1. provider / execution policy 的一等化
2. 把“怎么选策略”做成显式对象

不借的是：

1. 协议与插件的广覆盖

#### 从 oh-my-openagent 借

借的是：

1. 固定角色分工
2. 升级式执行
3. 后台并行和非阻塞工作

不借的是：

1. hook/plugin 生态化
2. 通用背景 agent 编排

### 3.2 结论

RepoRead 下一阶段最值得学的不是“更像 agent 平台”，而是：

> 用更少的重步骤，做更多的有效工作。

---

## 4. 目标形态：高吞吐文档生成引擎

下一阶段的目标架构可以概括为：

```text
Input Repo
  -> Catalog / Affected-Page Planning
  -> Execution Lane Selection
  -> Evidence Fabric
  -> Drafting Pipeline
  -> Verification Ladder
  -> Artifact Graph
  -> Publish / Incremental Refresh
```

和当前实现相比，变化不在于多出更多“层”，而在于现有层开始承载真正的策略语义。

### 4.1 六个关键构件

1. **Execution Lane Selector**
   - 决定当前 page 走 fast / standard / deep 哪条执行通道

2. **Execution Graph / Scheduler**
   - 决定哪些任务必须串行，哪些任务可以前推或并行

3. **Evidence Fabric**
   - 把 page-local 证据收集升级为 repo-level 证据复用层

4. **Verification Ladder**
   - 把 review 变成分层验证，而不是统一重审

5. **Escalation Policy**
   - 固定角色、固定升级条件，不做开放 agent 平台

6. **Incremental Regeneration**
   - 让变更后的重生成逐步接近“增量编译”

---

## 5. 下一阶段的主题与前置条件

下面的 `P6-P10` 不是“功能列表”，而是架构演进主线。

但在真正进入 `P6` 之前，需要先完成一个前置动作：

> **先建观测面，再做提效。**

原因很直接：

1. 没有基线，就无法知道 `Execution Graph` 到底快了多少
2. 没有 phase 级指标，就无法知道慢在 evidence、review 还是 revision
3. 没有升级率与复用率，就无法知道架构优化是在降成本，还是只是在换复杂度

所以这份文档里的真实执行顺序不是：

`P6 -> P7 -> P8 -> P9 -> P10`

而是：

`Observability Foundation -> P6 -> P7 -> P9 -> P8 -> P10`

---

## 6. P6 前置：Observability Foundation

### 6.1 目标

在做任何并行、升级、复用、增量化之前，先把性能与质量的观测面建立起来。

这不是附属工作，而是后续所有提效动作的测量基线。

### 6.2 当前问题

如果没有统一观测，后续优化会出现三个常见误判：

1. 以为慢在 drafter，实际慢在 reviewer
2. 以为并行有效，实际只是把等待从主链挪到了队列
3. 以为质量没下降，实际是 reviewer 升级率在悄悄上升

### 6.3 最小必备指标

建议先打通五个核心指标：

1. `book_total_latency`
2. `page_total_latency`
3. `llm_calls_per_page`
4. `tokens_per_page`
5. `review_escalation_rate`

再补三个结构性指标：

1. `evidence_reuse_rate`
2. `revision_reopen_rate`
3. `parallel_slot_utilization`

### 6.4 设计原则

1. 观测维度必须和后续架构动作一一对应
2. 指标必须能分 phase 看，而不是只有总耗时
3. 指标必须能按 page / lane / model role 拆开

### 6.5 验收标准

在进入 `P6 Execution Graph` 之前，至少应该能回答：

1. 一本书总时间花在哪几个 phase
2. 哪类 page 最慢
3. reviewer 占比多少
4. revision 重开率多少
5. evidence 复用几乎为零，还是已经有可见收益

---

## 7. P6：Execution Graph

### 7.1 目标

把 generation 从“顺序流程”升级成“受控工作图”。

重点不是无脑并行，而是：

1. 明确依赖关系
2. 允许非阻塞阶段前推
3. 减少主链等待

### 7.2 当前问题

当前结构虽然已经是纯业务编排，但业务编排本身仍过于顺序：

1. 当前页 review 时，下一页还没有开始准备
2. evidence / outline / draft / review 的等待链较长
3. 页与页之间缺少 pipeline overlap

### 7.3 目标设计

引入 `ExecutionGraph` 或 `PageExecutionPlan`：

```text
catalog
  -> page plan list
    -> page[i].prefetch_evidence
    -> page[i].outline
    -> page[i].draft
    -> page[i].verify
```

但执行规则不是“全开”，而是：

1. `publish` 仍保持 reading order
2. `page i` 进入 review 后，`page i+1` 可提前跑 evidence/outline
3. 某些低依赖页可以预取 evidence
4. 高依赖页仍保守串行

### 7.4 不做什么

1. 不做通用 DAG 平台
2. 不做任意用户自定义工作图
3. 不做跨项目任务编排

这里只做 RepoRead 自己的固定任务图。

### 7.5 收益

这是最直接的吞吐优化项。

预期收益：

1. 降低 page-to-page 空闲等待
2. 提升 API 并发利用率
3. 在保持 reading order 约束下提升整本生成速度

### 7.6 验收指标

1. `p50 total generation time / book` 明显下降
2. `worker/reviewer idle time` 明显下降
3. 允许并行的任务在 trace 中可见

---

## 8. P7：Verification Ladder

### 8.1 目标

把 reviewer 从“统一重审器”升级为“分层验证系统”。

### 8.2 当前问题

当前 reviewer 的成本和收益不总是匹配：

1. 低风险页也可能走较重 review
2. revision 后仍可能全量重审
3. deterministic checks 和 expensive factual checks 没有正式分层

### 8.3 目标设计

定义三层验证：

1. **L0 Deterministic Validation**
   - markdown structure
   - citation format
   - link integrity
   - page scope coverage

2. **L1 Cheap Semantic Review**
   - obvious scope drift
   - citation density
   - unsupported claim risk

3. **L2 Expensive Factual Review**
   - 只对高风险页触发
   - reviewer 真正深入验证证据

### 8.4 升级条件

以下情况进入 L2：

1. complexity 高
2. factual risk 历史偏高
3. evidence 缺口多
4. draft truncated
5. revision 超过 1 次
6. low citation density

### 8.5 设计原则

不是减少 review，而是：

> 把 reviewer 预算花在真正值得深审的页面上。

### 8.6 收益

1. 降低平均 reviewer 成本
2. 保持高风险页质量
3. 让“质量”和“速度”不再完全对冲

---

## 9. P8：Evidence Fabric

### 9.1 目标

把 evidence 从“单页临时产物”升级成“可共享的证据层”。

### 9.2 当前问题

当前 evidence 还是以 page 为中心：

1. 不同页可能重复读取相同文件
2. 相似主题页可能重复生成相似 finding
3. review 指出缺口后，经常又从 page-local 重跑

### 9.3 目标设计

Evidence 分两层：

1. **Repo Evidence Cache**
   - key: file hash / symbol / query class / locator
   - value: normalized evidence fragments

2. **Page Evidence Assembly**
   - 每页不再从零收集全部证据
   - 优先从共享层挑选，再补采缺口

### 9.4 重要限制

这不是向 memory 演进。

Evidence Fabric 只处理：

1. 代码证据
2. 可引用片段
3. 与 artifact graph 绑定的结构化结果

它不是聊天记忆，也不是 agent 长期记忆。

### 9.5 收益

1. 降低重复 IO
2. 降低重复 LLM 证据整理
3. 让 review-driven recollect 更聚焦

### 9.6 长远价值

这会成为 RepoRead 相对其他 4 个 agent 最有差异化的架构资产，因为：

> 别人是面向对话与任务，你是面向文档产物与证据链。

---

## 10. P9：Escalation Lanes

### 10.1 目标

把“多角色”和“升级”做成固定策略，而不是通用 agent delegation 平台。

### 10.2 为什么优先级高

这是你明确提出应该前置的点，而且判断是对的：

> 在质量已经可接受的前提下，固定角色升级策略比继续打磨 prompt 更能直接提升性能。

### 10.3 目标设计

定义三条执行 lane：

1. **Fast Lane**
   - 低复杂度页
   - 少 worker
   - 轻量 reviewer
   - 少 revision

2. **Standard Lane**
   - 默认页
   - 当前 balanced 路径的演进版

3. **Deep Lane**
   - 高复杂度、高失败率、高风险页
   - 更强 evidence
   - 更强 reviewer
   - 允许升级式复审

### 10.4 lane 决定什么

每条 lane 决定：

1. 是否启 planner
2. worker 数量与并发
3. drafter / reviewer 的 model route
4. reviewer 层级
5. revision budget
6. 是否允许 prefetch 和 overlap

### 10.5 关键原则

这不是做“任意 agent 互相 delegation”。

而是做：

> 固定角色图 + 固定升级条件 + 固定 lane 策略

建议角色始终保持有限：

1. planner
2. evidence worker
3. drafter
4. verifier-lite
5. verifier-deep

### 10.6 收益

1. 性能优化更可控
2. 成本可预测
3. 质量退化更容易定位

---

## 11. P10：Incremental Regeneration

### 11.1 目标

把 RepoRead 从“整本重生成”逐步演进为“增量编译”。

### 11.2 当前问题

现在的 generation 更像 batch pipeline：

1. 改动少量代码后，仍然容易整本重跑
2. 受影响 page 没有被正式建模
3. 相邻页和目录页的重算边界不清晰

### 11.3 目标设计

引入三样东西：

1. **Changed File -> Affected Page 映射**
2. **Page freshness / invalidation 规则**
3. **局部 publish / 局部 summary 更新**

### 11.4 具体能力

1. 仅重跑脏页
2. 相邻页只做轻量 revalidate
3. catalog 只在结构变化明显时重算
4. published summaries 局部更新

### 11.5 战略意义

这是 RepoRead 最应该向“编译系统”靠拢的一步。

长期来看，RepoRead 的最佳产品形态不是 chat shell，而是：

> 面向代码仓库的增量文档编译器。

---

## 12. 建议的执行顺序

如果目标是最快看到提效结果，我建议按下面顺序做：

1. `P6 前置：Observability Foundation`
2. `P6 Execution Graph`
3. `P7 Verification Ladder`
4. `P9 Escalation Lanes`
5. `P8 Evidence Fabric`
6. `P10 Incremental Regeneration`

原因：

1. 没有 `Observability Foundation`，后续优化无法量化收益
2. `P6 + P7` 最直接改善总时长
3. `P9` 决定性能优化是否可控
4. `P8 + P10` 会带来更深层的复用与增量能力，但工程跨度更大

换句话说：

- 先解决“看不见”
- 再解决“等待太多”
- 再解决“重审太贵”
- 再解决“谁值得升级”
- 最后解决“为什么还在重复做同样的事”

---

## 13. 需要先建立的观测面

如果不先把观测补起来，后续提效会变成主观判断。

建议先建立五个核心指标：

1. `book_total_latency`
2. `page_total_latency`
3. `llm_calls_per_page`
4. `tokens_per_page`
5. `review_escalation_rate`

再加三个结构性指标：

1. `evidence_reuse_rate`
2. `revision_reopen_rate`
3. `parallel_slot_utilization`

没有这些数据，就无法回答：

1. 是 evidence 慢，还是 reviewer 慢
2. 是并行度不够，还是升级过多
3. 是质量换来的慢，还是架构低效导致的慢

---

## 14. 近期最值得做的四件事

如果只选最值得优先启动的动作，我建议是：

### 14.1 动作一：先做 Observability Foundation

先不改执行策略，先把指标打通。

这是后续所有架构动作的前提。

### 14.2 动作二：引入 Execution Lane Selector

先不做完整工作图，只先把 page 分到：

1. fast
2. standard
3. deep

这是后续所有提效策略的入口。

### 14.3 动作三：把 reviewer 拆成分层验证

这是最容易直接降成本的地方。

### 14.4 动作四：做 page overlap 调度

让 `page i` review 时，`page i+1` 能开始做准备性工作。

如果只从工程价值排序，我会这样看：

1. `Observability Foundation` 让优化可测
2. `Execution Lane Selector` 让优化可控
3. `Verification Ladder` 让优化省钱
4. `page overlap` 让优化见效

这几步组合起来，通常比继续打磨 prompt 更容易带来明显速度收益。

---

## 15. 明确不应该误入的方向

### 15.1 不要把这轮演进做成“更通用”

RepoRead 的优势不在于覆盖更多 agent 场景，而在于：

1. 有明确产物
2. 有明确阶段
3. 有明确证据链

所以应该继续垂直深入，而不是横向泛化。

### 15.2 不要先做 memory

在当前目标下，memory 既不是主要瓶颈，也不是主要收益源。

### 15.3 不要先做 MCP / plugin

这会扩大外部能力面，但不会直接解决当前吞吐问题。

### 15.4 不要把 delegation 做成平台

RepoRead 更适合固定角色和固定升级策略，不适合开放式 agent 自由调度。

---

## 16. 最终判断

P0-P5 完成后，RepoRead 已经从“边改边补的 agent pipeline”进化成了“有清晰控制平面的生成系统”。

下一阶段不该继续围绕“怎么再多长几个层”，而应该围绕：

> 如何把这套控制平面用于提高吞吐。

所以 RepoRead 的下一阶段架构方向不是：

- Prompt OS
- Memory 系统
- MCP 平台
- 通用 agent 外壳

而是：

1. Execution Graph
2. Verification Ladder
3. Evidence Fabric
4. Escalation Lanes
5. Incremental Regeneration

如果用一句话总结下一阶段目标：

> 把 RepoRead 做成一个高质量、可升级、可复用、可增量的文档编译系统。
