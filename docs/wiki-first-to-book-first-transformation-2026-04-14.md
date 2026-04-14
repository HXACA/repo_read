# RepoRead 从 Wiki-First 到 Book-First 的完整改造方案

> 时间：2026-04-14  
> 状态：架构与产品形态改造指引  
> 背景前提：
> - `P0-P5` runtime 重构已完成
> - `P6` Throughput / Execution Lanes 已完成
> - `P7` Verification Ladder 已完成
> - 当前核心问题已从“能不能生成”转向“生成结果更像工程 wiki，而不是一本经过编排的技术书”

---

## 0. 这份文档回答什么问题

这份文档回答的是：

> 为什么 RepoRead 现在生成出来的内容已经很强，但仍然不够“像书”；  
> 以及如何在不牺牲证据可信度的前提下，把系统从 `wiki-first` 推进到 `book-first`。

这里的“book-first”不是要求 RepoRead 变成传统出版工具，而是要求它从“高质量知识切片生成器”升级成：

> 一个以读者路径为核心、以证据验证为底座的文档编译系统。

这份文档不讨论：

1. memory / compaction / replay 系统
2. MCP / plugin 平台化扩张
3. 通用 coding agent 化

因为当前问题不在泛化性，而在产物形态。

---

## 1. 背景判断

通过对 `hermes-agent/.reporead` 与 `hermes-agent/.zread` 的对比，可以明确看到：

1. `.reporead` 在工程可信度、证据密度、测试覆盖意识、内部机制解释深度上已经明显强于 `.zread`
2. `.zread` 在阅读路径、入门层组织、教程感、章节编排和“像一本书”的连续体验上仍然更好

这不是一句“`.reporead` 文风不够好”就能解释的问题，而是当前系统整体优化目标不同：

- `.reporead` 优化的是：覆盖率、证据引用、页面边界、校验通过率、吞吐成本
- `.zread` 优化的是：读者路径、章节顺序、概念递进、导读体验

所以 RepoRead 当前的主要问题不是“质量不够”，而是：

> 系统已经能稳定生成高可信内容，但仍然缺少显式的“成书编排层”。

---

## 2. 当前产物的症状

当前产物有四个非常稳定的特征：

1. 页数偏多、主题切分偏细
2. 页面局部质量很强，但整书节奏偏碎
3. deep-dive 页很多，how-to / onboarding / reference 页不足
4. 内容更像“可单页查阅的工程资料”，而不是“适合顺序阅读的技术书”

这四个症状不是偶然，它们都能在当前实现中找到直接原因。

---

## 3. 根因分析：为什么当前实现天然会产出 wiki

### 3.1 产物模型从一开始就是 `wiki page`

当前系统从命名到 prompt 都把目标定义成 `wiki`：

- `catalog` prompt 明确要求输出 `comprehensive wiki catalog`
- `drafter` prompt 明确要求写 `a single wiki page`
- `WikiJson` 的核心结构也是 `reading_order + page entries`

对应实现：

- `packages/core/src/catalog/catalog-prompt.ts`
- `packages/core/src/generation/page-drafter-prompt.ts`
- `packages/core/src/types/generation.ts`

这意味着系统默认把每页当作“相对独立、可查阅、可验证”的知识单元，而不是“章节”。

### 3.2 Catalog 的目标函数是 coverage-first

当前 catalog 最强的约束不是“读者怎么学”，而是“文件怎么覆盖”。

`catalog-prompt.ts` 的核心规则包括：

1. 每个非平凡 source file 必须至少落入一个页面的 `covered_files`
2. 目标是 `>80% coverage`
3. 每页建议覆盖 `5-30 files`
4. 不允许浅页，也不鼓励大而泛的页

这直接推动了三件事：

1. 页数自然变多
2. 主题自然变细
3. 页面边界优先按代码归属而不是读者学习曲线来切

这对工程可信度非常有利，但会天然压低“成书感”。

### 3.3 页面中间层是 evidence mapping，不是 pedagogy planning

`OutlinePlanner` 当前的职责，是把 page plan 和 evidence ledger 映射成 section 结构。

它做得很对，但它优化的是：

1. 每个 section 对应哪些证据
2. 每个 ledger entry 要落在哪些 section
3. fallback 时按文件分组也能成页

对应实现：

- `packages/core/src/generation/outline-planner.ts`

这意味着中间层的“结构”主要服务于引用完整性，而不是服务于教学编排。

### 3.4 Drafter 的主约束是 citation-safe，而不是 chapter experience

`page-drafter-prompt.ts` 很清楚地把写作约束压在这些点上：

1. 所有 factual claims 都要 citation
2. 必须严格遵守当前 page scope
3. 不要和前页重复
4. 优先基于 evidence / outline 写作

这些约束都正确，也很重要。

但缺少的是另一组同等强度的约束：

1. 当前页在整本书中的角色是什么
2. 这页是 onboarding、overview、how-to、explanation 还是 reference
3. 当前页应该帮助读者完成什么认知跃迁
4. 当前页和前后章节如何形成自然过渡

所以 drafter 写出来的是“高质量页面”，但未必是“高质量章节”。

### 3.5 Review 只在守 correctness，不在守 book quality

P7 的 `Verification Ladder` 已经很好地控制了 review 成本，但当前 review 维度仍然聚焦于：

1. scope compliance
2. citation density
3. unsupported claims
4. missing evidence

对应实现：

- `packages/core/src/review/l1-semantic-prompt.ts`
- `packages/core/src/review/reviewer-prompt.ts`
- `packages/core/src/generation/generation-pipeline.ts`

也就是说，review 会抓：

- “这页有没有证据”
- “有没有越界”
- “有没有不实”

但不会抓：

- “这章是否适合作为读者的第一章”
- “这两页是否应该合并”
- “是否缺少 quick start / how-to / appendix”
- “这章是否过于细碎，不利于顺读”

所以系统会越来越“对”，但不会自动越来越“像书”。

### 3.6 Pipeline 单位是页，不是整书

当前 generation pipeline 的编排单位是 page：

`catalog -> evidence -> outline -> draft -> review -> validate -> publish`

虽然已经有 reading order，但没有一个显式的 book-level pass 去做：

1. 章节重排
2. 页合并 / 页拆分
3. 前言 / quickstart / reference / appendix 的单独编排
4. 全书一致性的统一抛光

这就是为什么局部页质量可以很高，而整体仍像资料库。

### 3.7 结构字段存在，但没有成为真正的一等对象

`WikiJson.reading_order[]` 里现在已经有：

1. `section`
2. `group`
3. `level`

对应：

- `packages/core/src/types/generation.ts`

但这些结构信息没有真正贯穿后续链路：

1. `PageMeta.sectionId` 当前直接写成 `page.slug`
2. `VersionJson.pages[]` 没保留 `section/group/level`
3. web 端目录页目前只是把 `reading_order` 平铺渲染

对应：

- `packages/core/src/generation/generation-pipeline.ts`
- `packages/core/src/generation/publisher.ts`
- `packages/web/src/app/projects/[slug]/versions/[versionId]/version-client.tsx`

所以“书的目录层”在数据模型中存在一半，但在发布模型和阅读体验中还不是一等对象。

### 3.8 观测面只在量化吞吐与验证，不在量化成书质量

P6 的 Throughput Metrics 非常重要，但它当前量化的是：

1. latency
2. llmCalls
3. usage
4. reviewEscalationRate
5. phase-level cost

对应：

- `packages/core/src/generation/throughput-metrics.ts`

它没有量化：

1. onboarding 完整度
2. how-to 章节比例
3. 页面碎片化程度
4. 相邻页重复度
5. 教学路径是否自然

所以系统接下来的自动优化也会继续朝“更快地产出可靠 wiki”前进，而不是自然变成“更像书”。

---

## 4. 结论：当前系统的真实定位

当前 RepoRead 的真实定位不是“坏掉的书生成器”，而是：

> 一个已经相当成熟的 evidence-backed wiki compiler。

这不是负面判断。恰恰相反，这意味着：

1. 你已经拿到了很难做的那一半：证据可信度、边界控制、验证闭环、工程稳健性
2. 下一步不是推倒重来，而是在其上增加“book 编排层”

所以正确方向不是削弱当前能力，而是：

> 在保留 evidence-first 的前提下，引入 book-first 的规划、编排、发布与评估机制。

---

## 5. 目标形态：Book-First, Evidence-Backed

目标不是回到 `.zread` 那种“更轻但更弱引用”的产物，而是形成第三种形态：

> 既有 `.reporead` 的工程可信度，又有 `.zread` 的成书路径。

目标形态应该满足六条标准：

1. 第一层是读者路径，而不是文件覆盖
2. 页面有明确类型：overview / quickstart / how-to / explanation / reference / appendix
3. page generation 之上存在 book-level editorial pass
4. section/group/level/kind 成为发布与阅读端的一等对象
5. review 同时覆盖 correctness 和 pedagogy
6. 观测面既衡量吞吐，也衡量成书质量

---

## 6. 改造原则

### 6.1 保留的东西

必须保留：

1. `covered_files`
2. evidence / outline / draft / review 闭环
3. citation-first 的写作约束
4. P6 / P7 的吞吐与验证收益

### 6.2 不做的事

这轮改造不应该做：

1. 放松 citation 约束来换书感
2. 通过简单减少页数来假装“更像书”
3. 重新回到人工手写 catalog
4. 加 memory / MCP / 泛化平台能力

### 6.3 真正要新增的东西

应该新增：

1. `BookPlan` 层
2. `PageKind` / `ReaderGoal` 等更强的目录语义
3. `Editorial Pass`
4. `Pedagogical Review`
5. `Book Quality Metrics`

---

## 7. 核心改造方向

## 7.1 方向一：把 Catalog 升级为 Book Planner

当前 `catalog` 解决的是“怎么覆盖代码库”。  
下一步它要同时解决“怎么带读者读完整本书”。

### 新增结构字段

建议把 `WikiJson.reading_order[]` 从：

- `slug`
- `title`
- `rationale`
- `covered_files`
- `section`
- `group`
- `level`

升级为：

- `kind`: `overview | quickstart | how-to | explanation | reference | appendix`
- `reader_goal`: 读完这一页后应该获得什么
- `prerequisites`: 依赖哪些前序页面
- `depends_on`: 显式页依赖
- `narrative_role`: `entry | bridge | deep-dive | cookbook | reference-tail`
- `coverage_priority`: `core | supporting | appendix`

### Prompt 目标改写

`catalog-prompt.ts` 里的核心目标要从：

> 80%+ source coverage

改成双目标：

1. 必须形成完整读者路径
2. 在此基础上完成充分代码覆盖

也就是说，coverage 不再是第一原则，而是第二原则。

### 结构性硬约束

对中大型仓库，catalog 应默认强制出现以下页型：

1. `Project Overview`
2. `Quick Start / Getting Started`
3. `Architecture Overview`
4. 至少一个 `How-To / Extension Guide`
5. 至少一个 `Reference / Appendix` 区

这样可以避免整本书只有 deep-dive，没有 reader journey。

## 7.2 方向二：让 Page Generation 感知章节类型

当前 drafter 只知道：

1. 当前页标题
2. 当前页计划
3. covered files
4. evidence / outline / published pages

它还不知道：

1. 当前页属于哪种章节类型
2. 这一页在全书中的角色
3. 这一页的核心读者目标

### 需要新增的输入

`PageDraftPromptInput` 和 `MainAuthorContext` 需要增加：

1. `kind`
2. `readerGoal`
3. `section`
4. `group`
5. `previousPage`
6. `nextPage`

### Prompt 策略要分型

不同章节类型应有不同 prompt 约束：

- `overview`
  - 先给地图，再给层次，再给关键模块
- `quickstart`
  - 先给最短路径，再解释为什么
- `how-to`
  - 以目标任务为主轴，穿插必要实现解释
- `explanation`
  - 讲原理、讲权衡、讲机制
- `reference`
  - 高密度、强索引、少铺垫
- `appendix`
  - 长尾、边界、配置、回归矩阵

当前系统虽然在文风上已经要求“why -> what -> how”，但没有把这种差异做成章节类型策略。

## 7.3 方向三：加入 Book-Level Editorial Pass

这是当前最缺的一层。

你现在的 pipeline 是 page-local。  
需要新增一个 book-level editor，在两种时机工作：

1. `catalog` 后、page generation 前
2. 全部页面完成后、publish 前

### 阶段 A：Catalog Editorial Pass

在真正开始逐页生成前，对 catalog 做一次编辑性检查：

1. 是否缺 onboarding
2. 是否缺 architecture map
3. 是否缺 how-to
4. 是否 reference 内容过早出现在主阅读流
5. 是否存在明显碎页，应该合并

### 阶段 B：Pre-Publish Editorial Pass

在所有页面完成后，再做一次全书级检查：

1. 是否有相邻页重复
2. 是否有章节顺序不自然
3. 是否某些 deep-dive 应移入 appendix
4. 是否前几页不够“拉读者进门”
5. 是否缺少跨章过渡

这里不要求重写全书，而是优先做：

1. reorder
2. merge / demote
3. lightweight rewrite instructions

## 7.4 方向四：把 Review 从 correctness 扩展到 pedagogy

P7 已经很好，但还不够。

下一步不需要把 reviewer 变得更重，而是增加一个显式维度：

### L1b / Editorial Semantic Review

在现有 L1/L2 之外，加一个轻量的 pedagogical review 维度，检查：

1. 这页是否符合其 `kind`
2. 是否承担了应有的读者目标
3. 是否和前后章节形成自然关系
4. 是否过早进入细节
5. 是否应该被标记为 appendix/reference

这层不要求读源码，不要求再做 citation verification。  
它检查的是“这章是否像这章该有的样子”。

## 7.5 方向五：把结构信息真正发布出去

现在 `section/group/level` 已经在 `WikiJson` 里，但后续链路用得不够。

至少要做三件事：

1. `VersionJson.pages[]` 保留 `section/group/level/kind`
2. `PageMeta` 不再把 `sectionId` 简化成 `slug`
3. web 目录页按 section/group 分块渲染，而不是只平铺 `reading_order`

否则 catalog 生成再好的书结构，也只会在内部 JSON 里存在一次。

## 7.6 方向六：补齐 Book Quality Metrics

P6 之后，系统已经能测吞吐。  
下一步要能测“书感”。

建议新增以下指标：

1. `onboarding_presence_score`
2. `how_to_coverage_ratio`
3. `reference_tail_ratio`
4. `page_fragmentation_score`
5. `cross_page_duplication_rate`
6. `front_section_accessibility_score`
7. `avg_files_per_page`
8. `chapter_kind_distribution`

这些指标不需要一开始就自动化到极致，但必须先成为正式 report 的一部分。

---

## 8. 分阶段实施方法

下面的分期不是“功能点列表”，而是最稳妥的改造顺序。

## Phase B0：Book Baseline

### 目标

先建立“成书质量基线”，不要一边改目录一边失去对比能力。

### 具体动作

1. 对现有 `.reporead` 版本跑一轮书感评估
2. 为 3-5 个真实仓库产出：
   - chapter kind distribution
   - onboarding presence
   - average files per page
   - duplication heuristic
3. 记录与 `.zread` 的差异

### 验收

能回答：

1. 当前前 5 页是否承担 onboarding 角色
2. 当前主阅读流里 explanation/reference 的比例
3. 当前哪些页最像 appendix 却还留在正文

## Phase B1：Catalog Schema Upgrade

### 目标

把 `WikiJson` 从页面清单升级成书计划。

### 具体动作

1. 扩展 `WikiJson.reading_order[]` schema
2. 更新 `catalog-prompt.ts`
3. 更新 `catalog-validator.ts`
4. 给 `catalog-planner` 增加章节类型与前序依赖约束

### 边界

这一阶段不改 drafter，不改 UI，只改目录规划层。

### 验收

1. catalog 稳定产出 `kind/readerGoal/prerequisites`
2. 大中型仓库默认能产出 onboarding + architecture + how-to + reference

## Phase B2：Book-Aware Drafting

### 目标

让 drafter 真正按章节类型写作。

### 具体动作

1. 扩展 `PageDraftPromptInput`
2. 扩展 `MainAuthorContext`
3. 按 `kind` 分型写作
4. 在 outline 里加入章节角色信息

### 边界

不改 review，不改 publish。

### 验收

1. `overview` 页明显更像地图页
2. `how-to` 页明显更像操作指南
3. `reference` 页明显更像索引/清单页

## Phase B3：Editorial Pass

### 目标

把“书感优化”从页内责任提升到全书责任。

### 具体动作

1. 新增 `CatalogEditorialPass`
2. 新增 `BookEditorialPass`
3. 支持 reorder / merge / demote / appendix move

### 边界

这一阶段优先做“提出编辑操作并最小修改”，不做全书重写。

### 验收

1. 明显碎页能在 publish 前被识别
2. reference / regression 页能被自动下沉到尾部
3. 前几页更稳定地形成 onboarding 流

## Phase B4：Pedagogical Review

### 目标

把 review 维度从 correctness 扩到 book quality。

### 具体动作

1. 在 Verification Ladder 中新增 pedagogical check
2. 对 `kind` 做一致性审核
3. 对 front matter / how-to 做特定检查

### 边界

仍然不放松 citation/scope correctness。

### 验收

1. 页面不仅能因证据问题 revise，也能因章节角色不成立而 revise
2. 教程页和 reference 页有不同的审查重点

## Phase B5：Publishing & Reading Experience

### 目标

让“书结构”在产物和 UI 中真正可见。

### 具体动作

1. `VersionJson` 保留 richer structure
2. `PageMeta` 保留 chapter metadata
3. 版本页按 section/group 渲染
4. 正文区显式区分：
   - 主阅读流
   - 参考与附录

### 验收

1. 用户第一次进入版本页时，能看出这是一本书，不是平铺 wiki
2. `section/group/kind/level` 都可见

## Phase B6：Book Metrics & Regression Set

### 目标

让 book quality 进入持续评估。

### 具体动作

1. 把 book-quality 指标写入 report
2. 选定 2-3 个标杆仓库建立回归集
3. 定义“不能退化”的章节结构指标

### 验收

1. 每次生成后能同时看到：
   - 吞吐
   - 成本
   - 验证层级
   - 成书质量

---

## 9. 建议的执行顺序

建议顺序：

1. `B0 Book Baseline`
2. `B1 Catalog Schema Upgrade`
3. `B2 Book-Aware Drafting`
4. `B3 Editorial Pass`
5. `B5 Publishing & Reading Experience`
6. `B4 Pedagogical Review`
7. `B6 Book Metrics & Regression Set`

说明：

1. `B1 + B2` 决定内容源头是否变化
2. `B3` 决定全书是否真正成形
3. `B5` 决定用户是否能感知到“书结构”
4. `B4` 可以稍后接入，因为它依赖前面已有 `kind` 与 editorial semantics

---

## 10. 反模式：哪些“看起来对”其实会走偏

不要这样做：

1. 只把页数减少 20%，指望自然更像书
2. 只改 drafter prompt，不动 catalog schema
3. 只改 web UI，把平铺目录视觉分组一下
4. 用一个 post-process 脚本硬合并 markdown，不改上游规划
5. 为了教程感而放松 citation / scope / review

这些做法最多会做出“看起来更顺”的结果，但不会做出真正更稳的书。

---

## 11. 最小起步方案

如果只允许先做一小步，我建议先做这三件事：

1. `B1`：给 `WikiJson` 增加 `kind + readerGoal + prerequisites`
2. `B2`：让 drafter 按 `kind` 分型写作
3. `B5`：让 web 目录页按 `section/group/kind` 展示，而不是平铺

这三步一旦成立，RepoRead 的产物就会第一次从结构上开始偏离“纯 wiki”。

---

## 12. 最终判断

当前 RepoRead 最大的问题不是“生成质量不够”，而是：

> 它已经是一个很强的 wiki compiler，但还不是一个真正的 book compiler。

要跨过这一步，不需要放弃现在的证据体系，也不需要回到更松散的写法。真正要补的是：

1. 目录的读者语义
2. 页面类型的分型写作
3. 全书级编排层
4. 面向成书质量的 review 与 metrics

所以后续改造的方向应该非常明确：

> **保留 evidence-first，新增 book-first。**

