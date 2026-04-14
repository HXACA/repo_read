# RepoRead 下一波大改造统一路线图

> 时间：2026-04-14  
> 状态：统一版路线文档  
> 目的：把已经完成的 runtime / throughput / verification 工作，与下一波 `book-first` 改造收敛到同一份主文档中

> 关联文档：
> - [docs/runtime-refactor-blueprint-2026-04-13.md](./runtime-refactor-blueprint-2026-04-13.md)
> - [docs/throughput-first-architecture-evolution-2026-04-14.md](./throughput-first-architecture-evolution-2026-04-14.md)
> - [docs/wiki-first-to-book-first-transformation-2026-04-14.md](./wiki-first-to-book-first-transformation-2026-04-14.md)
> - [docs/superpowers/specs/2026-04-14-p6b-page-overlap-scheduler-design.md](./superpowers/specs/2026-04-14-p6b-page-overlap-scheduler-design.md)

---

## 0. 这份文档解决什么问题

RepoRead 到现在已经不是“能不能生成代码文档”的问题了。

当前真正的问题是：

1. 底层 runtime 和吞吐基础设施已经站住
2. 生成质量和工程可信度已经明显提升
3. 但产物仍然更像 `evidence-backed wiki`，还不够像“有明确读者路径的技术书”

所以这份文档的目标不是再写一份 phase 列表，而是把两条已经明确的主线收束成一句话：

> **RepoRead 下一波大改造，不是继续平台化，而是从“高吞吐 wiki compiler”推进到“高吞吐、强证据、book-first 的文档编译系统”。**

---

## 1. 当前状态：已经完成了什么

### 1.1 控制平面已经完成重构

`P0-P5` 已完成：

1. runtime 控制平面已从业务层剥离
2. `TurnEngine` 已成为统一 LLM 入口
3. `PromptAssembler` 已成为统一 prompt 入口
4. `ConversationContextManager` 已替代 ask 路径硬编码 turn slicing
5. `GenerationPipeline.run()` 已退化为业务编排器，而不是半个 runtime

这意味着后续内容改造，不需要继续在 `generation-pipeline.ts` 里打补丁式修功能。

### 1.2 提效基础设施已经就绪

`P6` 和 `P6b` 已完成：

1. `ThroughputMetricsCollector`
2. `ExecutionLaneSelector`
3. `Page Overlap Scheduler`
4. 失败路径遥测闭环
5. `throughput.json` 成为稳定观测面

现在已经能测：

1. page / phase latency
2. LLM calls
3. token usage
4. review escalation
5. prefetch hit / wait / orphaned cost

这意味着后续优化不再是凭感觉做。

### 1.3 验证体系已经分层

`P7 Verification Ladder` 已完成：

1. `L0` deterministic validation
2. `L1` cheap semantic review
3. `L2` expensive factual review

这一步的价值不是“review 变复杂”，而是后续可以在不失控涨成本的前提下继续改内容形态。

---

## 2. 现在的真正战略转向

前一阶段的关键词是：

1. 分层
2. 稳定
3. 提效
4. 可观测

下一阶段的关键词应该变成：

1. 读者路径
2. 章节类型
3. 全书结构
4. 成书体验

也就是说，系统重心从：

> “怎样更稳、更快地生成正确页面”

转向：

> “怎样在保留证据可信度的前提下，生成更像一本书的结果”

这个转向非常关键。

因为如果不承认这个转向，后续工作就会继续沿着旧惯性发展：

1. 更强 evidence
2. 更强 review
3. 更高覆盖率
4. 更细 phase 优化

结果只会得到“更强的 wiki”，而不是“更好的书”。

---

## 3. 关键判断：当前系统为什么天然产出 wiki

这部分不是重新展开完整分析，而是提炼成对后续路线最有用的结论。

### 3.1 `catalog` 的第一目标仍然是 coverage

当前 `catalog` 的最强约束是：

1. `>80%` source coverage
2. 每个文件要进入 `covered_files`
3. 页面避免过浅或过大

这会稳定地产出：

1. 更多页
2. 更细切分
3. 更强模块边界

但不会自然产出：

1. onboarding 页
2. quick start
3. how-to
4. appendix / reference tail

### 3.2 页面生成是 evidence-first，不是 pedagogy-first

当前 `outline -> draft -> review` 的优化目标是：

1. 证据完整
2. 作用域清晰
3. 引用可靠

这很好，但不够。

因为它不回答这些问题：

1. 这页对读者的角色是什么
2. 这一章在整本书中的职责是什么
3. 这一页应该帮读者完成什么认知跳跃

### 3.3 数据里已经有“书结构”的苗头，但没贯穿

现在 `WikiJson.reading_order[]` 已经有：

1. `section`
2. `group`
3. `level`

但这些信息没有真正贯穿到：

1. `PageMeta`
2. `VersionJson`
3. web 端目录展示

所以当前的问题不是“完全没有书结构”，而是：

> **书结构已经在 catalog 里出现了，但还没有成为正式的数据通路和产品通路。**

---

## 4. 战略边界：接下来不做什么

为了避免路线再发散，下一波大改造继续保持这些边界：

### 4.1 不做

1. memory / replay / compaction 系统
2. MCP / plugin 平台扩张
3. 通用 coding agent 化
4. 为了书感放松 citation / scope / verification
5. 一上来就做重 editorial pass

### 4.2 保留

必须保留：

1. `evidence-first`
2. `citation-first`
3. `Verification Ladder`
4. `Execution Lanes`
5. `P6b` 的吞吐收益

所以后续路线的总原则应该写死成一句话：

> **保留 evidence-first，新增 book-first。**

---

## 5. 目标形态：高吞吐 Book Compiler

下一波改造之后，RepoRead 的目标形态不应再只是：

> 高质量代码阅读 wiki 生成器

而应是：

> 高吞吐、强证据、book-first 的文档编译系统

这个目标形态的关键特征有 6 条：

1. 目录先服务读者路径，再服务代码覆盖
2. 页面有稳定的章节类型语义
3. 页面之间形成明确的前后依赖与阅读流
4. `section/group/kind/level` 成为发布与 UI 的一等对象
5. correctness review 与 pedagogical judgment 分开
6. 吞吐指标和成书指标同时存在

---

## 6. 下一波大改造的统一工作面

下一波不要再按孤立 phase 推，而要按 4 个工作面推进。

## 工作面 A：结构语义层

这是最关键的一层，也是最高杠杆的一层。

### 核心目标

把 `WikiJson` 从“页面清单”升级成“书计划”。

### 建议收敛后的 `kind`

第一版不要直接上 6 种 Diataxis 细分。  
先收敛到 4 种：

1. `guide`
2. `explanation`
3. `reference`
4. `appendix`

原因很简单：

1. `quickstart` 和 `how-to` 对 LLM 边界太细
2. 顶层 `kind` 越少，catalog 越稳定
3. 更细的区分可以沉到 `readerGoal` 与 `narrativeRole`

### 结构字段建议

在现有 `slug/title/rationale/covered_files/section/group/level` 基础上，新增：

1. `kind`
2. `readerGoal`
3. `prerequisites`
4. `narrativeRole`
5. `coveragePriority`

这会成为后续整个链路的语义源头。

## 工作面 B：内容生成层

### 核心目标

让页面生成真正感知章节类型，而不是只感知文件覆盖和 page scope。

### 重点

不同 `kind` 要有不同写作约束：

1. `guide`
   - onboarding / 概览 / 快速进入
2. `explanation`
   - 原理 / 机制 / 设计权衡
3. `reference`
   - 配置 / 接口 / 工具清单 / 查阅页
4. `appendix`
   - 回归矩阵 / 长尾 / 边界 / 历史兼容

也就是说，drafter 不再只写“正确页面”，而是写“正确类型的章节”。

## 工作面 C：发布与阅读层

### 核心目标

把 catalog 里已有的结构信息真正发布出来，并在产品侧呈现。

### 重点

1. `PageMeta` 不能再把 `sectionId` 简化成 `slug`
2. `VersionJson.pages[]` 需要保留 richer structure
3. web 目录页不再平铺 `reading_order`
4. `appendix / reference` 要和主阅读流做视觉与结构区分

这一层的价值非常高，因为它几乎不增加 LLM 成本，却直接改变用户感知。

## 工作面 D：成书质量观测层

### 核心目标

在现有 throughput 指标之外，引入 book-quality 指标。

### 应该量化的内容

1. `guide` 页占比
2. 前 5 页的 onboarding 覆盖度
3. `appendix/reference` 是否被下沉到尾部
4. 相邻页重复率
5. 页面碎片化程度

这层不需要一开始就做得很复杂，但必须开始记录。

---

## 7. 统一执行顺序

如果按一波大的改造来做，我建议的统一顺序是：

1. **已完成基座**
   - `P0-P7`
   - `P6b`

2. **第一波内容源头改造**
   - 结构语义层
   - 内容生成层

3. **第二波发布呈现改造**
   - 发布与阅读层

4. **第三波质量治理改造**
   - 成书质量观测层
   - 再根据结果决定是否需要 editorial pass

把它翻译成更明确的执行顺序，就是：

1. `P6b` 已完成 ✅
2. `catalog schema + structure passthrough` 已完成 ✅（B5a + B1）
3. `kind-aware drafting` 已完成 ✅（B2）
4. `book-structured publishing + UI` 已完成 ✅（B5b）
5. 吞吐次线基础设施已完成 ✅（P9/P8/P10 foundation）
6. 最后根据真实产物决定是否要上 `editorial pass`

这点非常重要：

> `editorial pass` 不是下一步默认动作，而是 `B1/B2/B5` 之后的条件性动作。

---

## 8. 为什么现在不应该先做 Editorial Pass

这是当前最容易走偏的地方。

直觉上会觉得：

> “既然不像书，那就上一个全书编辑器”

但现在不该这么做，原因有三条：

1. `editorial pass` 是最重的一层
2. 如果目录语义和页面类型还没立住，editor 只能在错误源头之上反复补救
3. 很多“像书”的问题，可能在 `kind + structure passthrough + kind-aware drafting` 后就已经自然消失大半

所以更稳的策略是：

1. 先改源头
2. 再改数据通路
3. 再看是否还需要 editor

---

## 9. 这波大改造之后，路线怎么继续

等 book-first 主线立住之后，再考虑两类更深的工作：

### 9.1 吞吐次线进展（2026-04-14 更新）

以下基础设施已完成：

| 项目 | 状态 | 说明 |
|------|------|------|
| P9 Escalation Lanes | ✅ foundation | `EscalationPolicy` 已将 lane 绑定为显式成本结构，pipeline 只消费 policy 对象 |
| P8 Evidence Fabric | ✅ foundation | `EvidenceCacheKey` + `ArtifactStore.loadEvidenceCache/saveEvidenceCache` 已建立，未接入 pipeline read-through |
| P10 Incremental Regen | ✅ foundation | `analyzeDirtyPages()` 已实现 covered_files 级脏页分析，CLI `--incremental` 已预留 |

下一步深化这三项需要：
1. P9：基于真实基线数据微调 lane 策略表的具体数值
2. P8：在 evidence-coordinator 里接入 read-through cache
3. P10：在 pipeline 里接入 dirty-page → skipSlugs 映射

### 9.2 再考虑更高阶的质量治理

只有在以下条件仍成立时，才值得上 `Book Editorial Pass`：

1. 目录已经稳定带 `kind`
2. 页面已经按 `kind` 分型写作
3. UI 已能展示书结构
4. 真实项目上仍存在明显的：
   - 相邻页重复
   - 前几页不够 onboarding
   - reference 内容过早出现在主线

换句话说，editorial pass 是后手，不是前手。

---

## 10. 当前最值得推进的一波范围

如果你现在准备“搞一波大的”，我建议这一波的边界就定成：

### 本波范围

1. 结构语义层
2. 内容生成层
3. 发布与阅读层

### 本波不做

1. 新的 scheduler 优化
2. editorial pass
3. evidence fabric
4. incremental regeneration

### 本波的成功标准

1. 新生成的 `wiki.json` 不再只是 page list，而是 book plan
2. Hermes 这类仓库前几页稳定出现 `guide`
3. `reference / appendix` 明显从主阅读流中被拉开
4. web 端第一次能看出“这是一本书”，而不是“一个平铺 wiki 列表”

---

## 11. 最终判断

RepoRead 现在已经完成了最难的一步：

> 它已经有能力稳定生成高可信内容。

下一步真正要做的，不是继续强化“内容是否正确”，而是把系统从：

> `high-quality wiki compiler`

推进到：

> `high-quality book compiler`

这不是推翻前面的工作，而是在前面工作的基础上加上新的优化目标。

所以现在最正确的路线不是“继续拆独立小 phase”，而是把下一波大改造统一成一句话：

> **用已经完成的 runtime / throughput / verification 基座，去做一次结构语义、章节类型、发布呈现一体化的 book-first 改造。**

