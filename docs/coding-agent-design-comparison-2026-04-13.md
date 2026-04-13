# RepoRead 与四个 Coding Agent 的设计与工程比较

> 时间：2026-04-13  
> 对比对象：`RepoRead`、`claude-code`、`codex`、`opencode`、`oh-my-openagent`  
> 目标：不是做“谁更强”的泛评测，而是提炼出 **RepoRead 下一轮迭代真正该吸收什么、避免什么、先做什么**

---

## 0. 阅读范围与比较口径

本次比较采用两层方法：

1. **全量文件盘点**：先扫每个仓库的完整文件清单，建立模块地图。  
   当前文件规模大致为：`RepoRead 316`、`claude-code 1903`、`codex 3521`、`opencode 4322`、`oh-my-openagent 1634`。
2. **控制平面深读**：重点阅读最能决定系统行为的模块，而不是平均扫所有 UI 细节。核心关注：
   - prompt 管理
   - 上下文压缩 / 溢出恢复
   - agent loop / turn loop
   - tool registry / tool execution
   - provider / MCP / 协议层
   - config layering
   - 模块抽象与工程风格

代表性阅读路径包括：

- `RepoRead`：`packages/core/src/agent/agent-loop.ts`、`generation/generation-pipeline.ts`、`generation/evidence-coordinator.ts`、`generation/page-drafter-prompt.ts`、`review/reviewer-prompt.ts`、`config/*`
- `claude-code`：`src/constants/prompts.ts`、`src/utils/systemPrompt.ts`、`src/QueryEngine.ts`、`src/query.ts`、`src/services/compact/*`、`src/services/tools/*`、`src/services/mcp/*`
- `codex`：`codex-rs/core/src/codex.rs`、`codex-rs/core/src/compact.rs`、`codex-rs/core/src/context_manager/history.rs`、`codex-rs/tools/*`、`codex-rs/config/*`、`codex-rs/app-server/*`、`codex-rs/codex-api/*`
- `opencode`：`packages/opencode/src/agent/agent.ts`、`session/prompt.ts`、`session/processor.ts`、`session/compaction.ts`、`tool/registry.ts`、`provider/provider.ts`、`mcp/index.ts`、`config/config.ts`
- `oh-my-openagent`：`src/index.ts`、`src/create-managers.ts`、`src/agents/dynamic-agent-prompt-builder.ts`、`src/agents/prometheus/system-prompt.ts`、`src/hooks/preemptive-compaction.ts`、`src/hooks/anthropic-context-window-limit-recovery/recovery-hook.ts`、`src/features/background-agent/*`、`src/tools/delegate-task/*`

需要单独说明的是：`oh-my-openagent` 不是完整独立 runtime，更像是 **叠加在 OpenCode / Claude Code / OpenClaw 之上的增强层**。因此它在“loop 原生性”上天然不和前四者同类，但在“工程策略层”上非常值得比较。

---

## 1. 一句话结论

- **RepoRead**：最聚焦、最清晰，但更像“面向代码阅读与写作的专用 agent pipeline”，不是完整通用 coding agent runtime。
- **Claude Code**：能力最全，prompt/compact/tool safety 做得最成熟，但代码体量巨大、feature flag 很重，理解成本最高。
- **Codex**：核心运行时、协议、配置、tool registry 的边界最干净，是五者里**系统分层最像长期可维护产品内核**的实现。
- **OpenCode**：provider-agnostic 和 client/server 思路最彻底，整体开放性最好，但 session/tool/plugin 责任边界略分散。
- **oh-my-openagent**：最激进、最有“执行欲”，在 subagent、fallback、skill+MCP 联动上最有创造性，但也最容易出现 hook / manager / tool 的交叉复杂度。

对 RepoRead 的核心判断是：

> RepoRead 不应该追求“追平所有通用 coding agent 能力”，而应该把自己做成 **页面化代码阅读 / 写作工作台**，同时选择性吸收 Claude Code、Codex、OpenCode、oh-my-openagent 在运行时控制平面上的成熟做法。

---

## 2. 总比较矩阵

| 维度 | RepoRead | Claude Code | Codex | OpenCode | oh-my-openagent |
| --- | --- | --- | --- | --- | --- |
| Prompt 管理 | 简洁但分散 | 很强，分层明确 | 很强，消息语义清楚 | 中上，按 provider/agent 组合 | 强但碎片化 |
| 上下文压缩 | 弱，尚未统一 | 很强，多层 compaction | 很强，历史管理严密 | 中上，summary + prune | 强，偏补丁式恢复 |
| Agent Loop | 中，已自管 loop | 很强，状态机成熟 | 很强，turn/runtime 清晰 | 中上，session 驱动 | 弱原生、强增强 |
| 多协议支持 | 弱 | 强 | 很强 | 很强 | 中，主要靠宿主 |
| Tool 能力 | 专用且少 | 极强 | 很强 | 强 | 极强（增强后） |
| 配置便捷性 | 简单 | 强但复杂 | 很强 | 强 | 很强但重 |
| 模块抽象 | 清楚但偏业务内聚 | 强但臃肿 | 最佳 | 中上 | 创新但容易缠绕 |
| 代码优雅性 | 中上 | 中 | 高 | 中上 | 中 |

如果把“适合 RepoRead 借鉴的优先级”单独排序：

1. **Codex 的 runtime / protocol / config layering**
2. **Claude Code 的 prompt layering / compaction / tool execution discipline**
3. **OpenCode 的 provider-agnostic + tool registry + client/server 分离**
4. **oh-my-openagent 的 continuation / background task / skill+MCP 按需联动**

---

## 3. 不止“学什么”：还要“怎么学”

这一节是对前文的补强。前面回答的是“哪个项目在哪些维度更强”，但真正能指导迭代的，不是结论本身，而是：

1. **先读哪里**
2. **读的时候在验证什么问题**
3. **读完后沉淀什么可迁移资产**
4. **如何避免把对方的历史包袱一并抄回来**

### 3.1 一套统一的学习方法

建议把五个项目都按同一条阅读路径拆开，不要一上来就“从入口读到结尾”。

#### 第一步：先找控制平面，不要先读 UI

优先读：

- prompt 装配点
- turn / session / query loop
- tool registry
- tool execution
- context / compact
- config resolver
- provider / MCP / protocol

不要先读：

- 组件库
- terminal UI 渲染细节
- 杂项 command / menu / onboarding

原因很简单：你要学的是 **系统怎么工作**，不是 **界面怎么画**。

#### 第二步：每个仓库只回答 5 个问题

读代码时只盯住这五个问题，能极大减少信息噪音：

1. 一次 turn 是从哪里开始、在哪里结束的？
2. prompt 是在什么地方被拼出来的？
3. 上下文超限时，系统如何退化或恢复？
4. tool call 是如何注册、调度、并发、回写历史的？
5. 配置如何决定模型、权限、MCP、技能和运行模式？

如果某个文件不能帮助回答这五个问题，就先不要深挖。

#### 第三步：从“文件”提升到“机制”

不要只记：

- `QueryEngine.ts`
- `codex.rs`
- `session/prompt.ts`

而要把它们抽象成机制：

- `prompt assembly`
- `turn runtime`
- `context manager`
- `tool registry`
- `execution policy`
- `artifact persistence`

真正要迁移进 RepoRead 的，不是具体文件组织，而是这些机制。

#### 第四步：对每个机制都做三层输出

每读完一个机制，都输出三样东西：

1. **它解决了什么问题**
2. **它靠什么结构解决**
3. **它有哪些前提，不满足时会失效**

例如：

- Claude Code 的 compaction 解决的是“长会话下 prompt 失控”
- 它靠的是多层 compaction + streaming loop 内恢复
- 它的前提是已有统一 query runtime；如果 RepoRead 还没有统一 runtime，直接照搬只会散落

#### 第五步：始终做“可迁移性判断”

每学到一个设计，都问自己：

1. 这是 **RepoRead 现在就缺的核心能力**，还是对方的产品包袱？
2. 这是 **内核能力**，还是 **大产品配套能力**？
3. 这项设计在 RepoRead 里是否需要先有别的前置抽象？

如果三问里有两问回答不了，就先不要迁移。

### 3.2 一个可执行的阅读顺序

如果后续还要继续深入这五个仓库，建议按下面的顺序，而不是平均发力：

1. **Codex**
   - 先读 `codex-rs/core/src/codex.rs`
   - 再读 `codex-rs/core/src/compact.rs`
   - 再读 `codex-rs/tools/src/tool_registry_plan.rs`
   - 最后读 `codex-rs/config/*`
   - 目标：学分层与内核边界
2. **Claude Code**
   - 先读 `src/utils/systemPrompt.ts` / `src/constants/prompts.ts`
   - 再读 `src/query.ts` / `src/QueryEngine.ts`
   - 再读 `src/services/compact/*`
   - 最后读 `src/services/tools/*`
   - 目标：学 prompt 管理与长会话运行时治理
3. **OpenCode**
   - 先读 `packages/opencode/src/session/prompt.ts`
   - 再读 `session/processor.ts`
   - 再读 `tool/registry.ts`
   - 再读 `provider/provider.ts`、`mcp/index.ts`
   - 目标：学 provider-agnostic 与开放注册表
4. **oh-my-openagent**
   - 先读 `src/index.ts`、`src/create-managers.ts`
   - 再读 `src/tools/delegate-task/*`
   - 再读 `src/features/background-agent/*`
   - 再读 compaction / fallback hooks
   - 目标：学增强策略，不学宿主替代
5. **RepoRead 自身**
   - 回头再读 `generation-pipeline.ts`
   - 用前四者的抽象重新标注 RepoRead 当前缺失项
   - 目标：不是继续熟悉代码，而是识别“应该拆什么层”

### 3.3 不要“按文件学”，要“按调用链学”

真正高效的方式不是文件列表，而是调用链：

- Prompt 怎么从 config / mode / skills 进入一次 turn
- 一次 turn 怎么进入 model stream
- tool call 怎么回到上下文
- compact 怎么改写历史
- reviewer / subagent 怎么作为子流程插入

建议后续继续研究时，优先为每个项目补出下面这些链路图，而不是再写静态模块图：

1. `user input -> prompt assembly -> model call -> tool execution -> history update`
2. `context overflow -> compact/retry -> resumed turn`
3. `subagent request -> child runtime -> result merge`
4. `config load -> resolved runtime settings -> model/tool exposure`

这些链路图会比“目录树理解”更接近真实迁移价值。

### 3.4 要学“约束条件”，不是只学“功能点”

很多设计之所以成立，不是因为它写得巧，而是因为它有隐含前提。

例如：

- Codex 的强协议分层，建立在 Rust 强类型和 app-server 统一消息模型上
- Claude Code 的多层 compact，建立在统一 query runtime 上
- OpenCode 的开放性，建立在 provider/plugin 都是一等对象上
- oh-my-openagent 的 hook 策略，建立在宿主 runtime 已经足够强的前提上

所以学习时要专门记录：

- 该设计依赖什么前置抽象
- 该设计在哪种产品阶段值得做
- 该设计在 RepoRead 里缺少什么前置条件

### 3.5 最终产物应该是什么

这次阅读的理想产物，不应该只是一篇比较文档，而应逐步沉淀成三类资产：

1. **机制卡片**
   - 如 `PromptAssembler`、`ContextManager`、`TurnEngine`
   - 每张卡片写清：目标 / 结构 / 前提 / 不该照搬的部分
2. **迁移清单**
   - 哪些机制可直接做
   - 哪些机制要等前置抽象落地再做
3. **反模式清单**
   - 巨型文件
   - hook 取代内核
   - 先暴露平台化配置再补抽象
   - 业务 pipeline 吞掉 runtime 职责

只有把阅读结果压成这三类资产，学习才会转化成迭代能力。

---

## 4. Prompt 管理比较

### 4.1 RepoRead

RepoRead 的 prompt 目前是**角色级 prompt 文件 + 业务阶段调用**：

- `packages/core/src/generation/page-drafter-prompt.ts`
- `packages/core/src/review/reviewer-prompt.ts`
- `packages/core/src/generation/fork-worker-prompt.ts`
- `packages/core/src/catalog/catalog-prompt.ts`

优点：

- 非常容易读懂，每个角色 prompt 与业务动作强绑定。
- 对“页面生成”这个专用场景来说足够直接。

问题：

- 缺少统一 prompt 装配器，prompt 片段没有“系统级 layering”。
- `ask`、`research`、`generation` 三条链的 prompt 体系并不统一。
- 配置、权限、模型族差异、工具说明、技能说明，没有一个公共的 prompt 编排中心。

### 4.2 Claude Code

Claude Code 的 prompt 是**显式分层装配**：

- `src/constants/prompts.ts`
- `src/utils/systemPrompt.ts`
- `src/context.ts`

几个关键点非常值得学：

1. **分段构造**：system prompt 不是一大坨字符串，而是由 intro / tasks / actions / hooks / MCP / output style / language 等 section 组合出来。
2. **动态边界**：`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 明确区分可缓存与不可缓存部分。
3. **替换/叠加语义清楚**：默认 prompt、custom prompt、agent prompt、append prompt、override prompt 之间优先级明确。

代价是实现明显变重，`src/constants/prompts.ts` 已经接近“prompt runtime”。

### 4.3 Codex

Codex 的 prompt 管理比 Claude Code 更“协议化”：

- 基础指令：`codex-rs/protocol/src/prompts/base_instructions/default.md`
- 结构化 developer / permissions / collaboration mode：`codex-rs/protocol/src/models.rs`
- turn 初始上下文装配：`codex-rs/core/src/codex.rs`

它的优点不是 prompt 文案更强，而是 **prompt 元素都被建模成协议消息**：

- `BaseInstructions`
- `DeveloperInstructions`
- `UserInstructions`
- collaboration mode developer message
- apps / skills / plugins / environment context

这使 prompt 不再只是字符串模板，而是 session/turn state 的显式投影。这个方向比 Claude Code 更适合做长期演化。

### 4.4 OpenCode

OpenCode 的 prompt 思路是“**provider prompt + agent prompt + environment + instruction files**”：

- `packages/opencode/src/session/system.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/instruction.ts`

它比 RepoRead 强的地方在于：

- 有 provider-family prompt：`anthropic.txt`、`gpt.txt`、`gemini.txt`、`codex.txt`
- 有 instruction 文件发现机制：`AGENTS.md` / `CLAUDE.md` / `CONTEXT.md`
- prompt 最终在 session 入口统一装配

但它不像 Codex 那样把 prompt 变成强协议对象，仍然偏“运行时拼装字符串”。

### 4.5 oh-my-openagent

oh-my-openagent 的 prompt 系统很强，但**中心不够单一**：

- agent prompt builder：`src/agents/dynamic-agent-prompt-builder.ts`
- planner prompt：`src/agents/prometheus/system-prompt.ts`
- 各 agent prompt：`src/agents/*`
- hook 注入：大量分布在 `src/hooks/*`
- 但 `src/plugin/system-transform.ts` 目前是空实现

这说明它的 prompt 能力更多来自“**很多地方都能插 prompt**”，而不是“有一个强中心装配器”。它非常灵活，但长期会让 prompt 行为更难推断。

### 4.6 对 RepoRead 的结论

RepoRead 下一步不该继续堆更多单独 prompt 文件，而应引入一个 **统一的 Prompt Assembly Layer**：

- 输入：role、mode、provider family、quality profile、tool exposure、page/review context
- 输出：`base + developer + contextual_user + tool appendix + role appendix`

建议直接吸收：

- **学 Claude Code**：section 化 prompt 组装、缓存边界
- **学 Codex**：把 permissions / collaboration mode / user instructions 变成结构化 prompt 层，而不是普通字符串拼接
- **不要学 OMO**：不要让 prompt 注入分散到大量 hook 再靠执行顺序兜底

---

## 5. 上下文压缩与溢出恢复比较

### 5.1 RepoRead

RepoRead 目前有两个优点、两个缺口：

优点：

1. 页面生成链已经开始采用 **pointer-first** 思路：evidence 和 outline 落盘，再让 drafter 按需读取。代表实现：`packages/core/src/generation/generation-pipeline.ts`。
2. reviewer 不再必须继承作者全文上下文，方向是对的。

缺口：

1. `packages/core/src/agent/agent-loop.ts` 里 `maxInputTokens` 还是“reserved for P2 compression, not used yet”。
2. `AskService` 只是保留最近 4 轮对话，`ResearchService` 也没有统一的 context manager，这意味着 RepoRead 还没有真正的“全局上下文治理”。

结论：RepoRead 现在做的是 **页面产物压缩**，不是 **会话上下文压缩**。

### 5.2 Claude Code

Claude Code 的 compaction 是五者里最成熟、层数最多的：

- `src/services/compact/compact.ts`
- `src/services/compact/sessionMemoryCompact.ts`
- `src/query.ts`

它至少做了四层事：

1. 自动 compact
2. session memory compact
3. microcompact / snip / tool-result budget
4. prompt-too-long / max_output_tokens 的恢复重试

这不是“总结一下历史”这么简单，而是一个完整的上下文控制平面。

### 5.3 Codex

Codex 的 compaction 最“内核化”：

- `codex-rs/core/src/compact.rs`
- `codex-rs/core/src/context_manager/history.rs`

它的重点不只是 summary，而是：

- 维护标准化的 `ContextManager`
- 保证工具调用对、图像替换、reference context baseline 都不被破坏
- 在 compaction 后重新建立历史基线

这是最值得 RepoRead 借鉴的点：**把 compact 当成 history rewrite，而不是单次 summarize 调用**。

### 5.4 OpenCode

OpenCode 的 compaction 做法比 Claude/Codex 轻，但很实用：

- `packages/opencode/src/session/compaction.ts`

特点：

- 在 summary 之前先 prune 旧 tool output
- overflow 时会回退到更早的 user message 作为 replay 边界
- compaction 由专门的隐藏 agent 负责

这套方案很适合快速落地，但“历史一致性”不如 Codex 严谨。

### 5.5 oh-my-openagent

oh-my-openagent 的上下文治理是“**主动预防 + 被动补救**”双层：

- 主动预防：`src/hooks/preemptive-compaction.ts`
- 被动补救：`src/hooks/anthropic-context-window-limit-recovery/recovery-hook.ts`

它很擅长在 Anthropic 类错误出现后做补偿，但这套逻辑明显更像“强力补丁层”，依赖宿主 runtime 的行为时序。

### 5.6 对 RepoRead 的结论

RepoRead 最该补的不是“写个 compact prompt”，而是引入一个统一 `ContextManager`：

1. 页面链：继续 pointer-first，避免大对象入 prompt。
2. 问答链：从“最近 4 轮”升级成可压缩历史。
3. 研究链：对子问题、证据、综合结果引入可持久化摘要。
4. 工具链：对大输出先截断 / 外置，再决定是否进上下文。

建议路线：

- **第一阶段学 OpenCode**：先做 tool output prune + session summary
- **第二阶段学 Claude Code**：补自动 compact / reactive recovery
- **第三阶段学 Codex**：把 compact 升级为 history rewrite 和 baseline 管理

---

## 6. Agent Loop 与运行时比较

### 6.1 RepoRead

RepoRead 已经有自管 loop，这是加分项：

- `packages/core/src/agent/agent-loop.ts`

但它主要还是被页面生产链驱动：

- `generation-pipeline.ts`
- `AskService`
- `ResearchService`

问题在于三条链共用同一个 loop 核，但**没有统一 turn runtime**，所以：

- page / ask / research 的状态推进逻辑是分散的
- 没有统一 continuation reason
- 没有统一 interruption / compaction / retry / overflow 状态机

### 6.2 Claude Code

Claude Code 的 `QueryEngine + query.ts` 是非常完整的 turn runtime：

- `src/QueryEngine.ts`
- `src/query.ts`
- `src/services/tools/toolOrchestration.ts`

其强项在于：

- streaming 和 non-streaming 共享主循环
- tool batch 并发策略显式
- fallback / budget / compact / stop hook 都在同一运行时里处理

缺点是太重，模块边界不总是优雅。

### 6.3 Codex

Codex 的 loop 是五者里最像“系统内核”的：

- `codex-rs/core/src/codex.rs`
- `codex-rs/tools/src/tool_registry_plan.rs`
- `codex-rs/tools/src/agent_tool.rs`

特点：

- session / thread / turn 是一等概念
- events、approvals、agents、MCP、realtime 都统一进一个协议事件流
- tool registry 是 declarative 的，不是 if/else 堆出来的

这是 RepoRead 应该借鉴的长期目标。

### 6.4 OpenCode

OpenCode 的 loop 由 `SessionPrompt + SessionProcessor` 驱动：

- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/processor.ts`

优点：

- session 视角清楚
- tool call / tool result / reasoning part 都进消息存储
- 和 provider / plugin / permission 接得自然

不足：

- `session/prompt.ts` 太大，prompt 装配、tool 解析、subtask 处理耦合在一起

### 6.5 oh-my-openagent

OMO 的核心不是 loop，而是对宿主 loop 的“驱动增强”：

- background manager：`src/features/background-agent/manager.ts`
- delegate-task：`src/tools/delegate-task/prompt-builder.ts`
- runtime fallback：`src/hooks/runtime-fallback/hook.ts`
- tmux subagent：`src/features/tmux-subagent/manager.ts`

这让它很会“逼系统继续跑下去”，但原生 loop 的可预测性不如前三者。

### 6.6 对 RepoRead 的结论

RepoRead 下一轮最值得做的是把 `generation / ask / research` 三条链收拢到 **统一 Turn Engine**：

- 统一 `TurnState`
- 统一 `ContinueReason`
- 统一 `RetryPolicy`
- 统一 `ContextOverflowPolicy`
- 统一 `ToolExecutionBatchPolicy`

换句话说，不再让 `generation-pipeline.ts` 同时承担：

- 业务编排
- loop 驱动
- retry 策略
- evidence persistence
- reviewer 反馈折返

业务 pipeline 应该在 runtime 之上，而不是 runtime 本身。

---

## 7. 多协议支持与 Tool 能力比较

### 7.1 RepoRead

RepoRead 的工具面向“代码阅读工作台”而不是“通用 coding agent”：

- `read`
- `grep`
- `find`
- `git`
- `bash`
- `pageRead`
- `citationOpen`
- `Task` / `Agent`

这是对的，但要明确它的代价：当前并不具备 MCP、LSP、SDK、remote control、realtime、多客户端协议能力。

### 7.2 Claude Code

Claude Code 在工具和协议面是极强的：

- 工具注册：`src/tools.ts`
- 工具执行：`src/services/tools/*`
- MCP：`src/services/mcp/*`
- CLI transports / bridge / remote：`src/cli/transports/*`、`src/bridge/*`

这是“成熟产品能力面”的典型实现，但维护成本也最高。

### 7.3 Codex

Codex 是这一维度最完整、也最工程化的：

- tool registry：`codex-rs/tools/*`
- app server：`codex-rs/app-server/*`
- realtime websocket：`codex-rs/codex-api/src/endpoint/realtime_websocket/*`
- SDK：`sdk/typescript/*`、`sdk/python/*`
- MCP：`codex-rs/codex-mcp/*`

它不仅支持多协议，而且这些协议共享同一套强类型模型。这是 Codex 最有壁垒的地方。

### 7.4 OpenCode

OpenCode 的多协议支持也很强，但风格更偏产品集成：

- server：`packages/opencode/src/server/server.ts`
- MCP：`packages/opencode/src/mcp/index.ts`
- provider：`packages/opencode/src/provider/provider.ts`
- web / desktop / vscode / sdk 都在同一 monorepo

相比 Codex，OpenCode 更“应用层友好”，但底层协议抽象不如 Codex 硬。

### 7.5 oh-my-openagent

OMO 增强的 tool 能力非常猛：

- `delegate-task`
- `background-task`
- `skill_mcp`
- `hashline-edit`
- `look_at`
- `interactive_bash`
- `lsp`
- `grep/glob/ast-grep`

但它主要通过 plugin/tool augmentation 获得这些能力，而不是自己拥有一个完整协议面。

### 7.6 对 RepoRead 的结论

RepoRead 不应该盲目追求 Claude/Codex 级别的工具面，而应走“**最小可用阅读/研究工具面 + 可扩展 registry**”路线：

第一步：

- 先把当前专用工具统一进 registry，并补上 tool metadata：
  - read-only / mutating
  - concurrency-safe
  - citation-producing
  - large-output-risk

第二步：

- 在确实需要多客户端前，不急着做 app-server 全家桶。
- 但可以先把 **内部 API 层** 抽出来，未来再挂 CLI/Web。

第三步：

- 如果后续要支持 IDE / 外部搜索 / 官方文档，优先做 MCP adapter，而不是先做私有协议。

---

## 8. 配置系统比较

### 8.1 RepoRead

RepoRead 配置简单直接：

- `packages/core/src/config/schema.ts`
- `packages/core/src/config/quality-profile.ts`
- `packages/core/src/config/resolver.ts`

优点：

- 容易理解
- 角色模型配置与 quality preset 已经具备雏形

不足：

- 没有强层级（global / project / session / requirements）的概念
- provider capability、fallback、tool policy 仍偏轻量

### 8.2 Claude Code

Claude Code 的配置非常强，但复杂度也高：

- `src/utils/config.ts`
- `src/services/mcp/config.ts`
- `src/utils/settings/*`

这是典型的“成熟产品型设置系统”，但不适合 RepoRead 直接照搬。

### 8.3 Codex

Codex 的配置系统是最佳样板：

- `codex-rs/config/*`
- `codex-rs/core/src/config/mod.rs`

优点：

- config layer stack 明确
- constraints / requirements / overrides 语义清楚
- permissions、network、sandbox、skills、MCP 都有正式 schema

这是 RepoRead 最应该直接借鉴的配置思路。

### 8.4 OpenCode

OpenCode 的配置偏“开放平台型”：

- `packages/opencode/src/config/config.ts`

能配的很多，global/local/managed 也兼顾了，但整体更偏产品集成与生态开放。

### 8.5 oh-my-openagent

OMO 的配置是“增强层超集配置”：

- `src/config/schema/oh-my-opencode-config.ts`
- `src/plugin-handlers/config-handler.ts`
- `src/shared/model-resolution-pipeline.ts`

优点是表达力极强；缺点是新用户和维护者都容易被配置面压垮。

### 8.6 对 RepoRead 的结论

RepoRead 配置系统的目标不应是“更丰富”，而应是“**更可演化**”：

- 现在学 Codex：先做 layer stack 和 resolved config provenance
- 不学 Claude/OMO：不要过早暴露大量产品级细分开关
- 保持 RepoRead 的产品判断：用户配置模型与质量档位，系统维护内部 prompt tuning / fallback / tool policy

---

## 9. 模块抽象合理性与代码优雅性

### 9.1 RepoRead

RepoRead 当前最好的地方是：**目标聚焦，所以代码可读性强**。  
最明显的问题是：**runtime concerns 还嵌在业务 pipeline 里**。

典型表现：

- `generation-pipeline.ts` 承担太多跨层责任
- prompt / runtime / persistence / validation 仍然没有完全切开

### 9.2 Claude Code

Claude Code 的优点是深、全、稳。  
它的缺点也来自这一点：

- `src/QueryEngine.ts`
- `src/query.ts`
- `src/constants/prompts.ts`

都已经非常大。feature flag、平台分支、产品历史包袱让 elegance 明显下降。

### 9.3 Codex

Codex 是五者里模块边界最合理的：

- `tools`、`config`、`protocol`、`app-server`、`core`、`mcp`、`sdk` 分层清楚
- 每层有自己的类型和职责

它不是最短最轻的实现，但**长期演化成本最低**。

### 9.4 OpenCode

OpenCode 的模块抽象总体健康，但几个超大文件已经开始显现压力：

- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/provider/provider.ts`
- `packages/opencode/src/config/config.ts`

它比 Claude Code 更轻，但也在向“大一统 runtime 文件”靠拢。

### 9.5 oh-my-openagent

OMO 的问题不在于“写得不聪明”，而在于 **横切关注点太多**：

- hook
- manager
- tool
- agent prompt
- config handler
- compatibility layer

这些能力都很强，但合在一起后，系统行为越来越依赖“加载顺序 + 约定”而不是“单一内核语义”。

### 9.6 对 RepoRead 的结论

RepoRead 现在最该做的是趁体量还小，把抽象边界定死：

1. **Turn Engine**：只负责 turn state / tool loop / retry / overflow
2. **Prompt Assembler**：只负责 prompt layering
3. **Artifact Store**：只负责 evidence / outline / draft / review / validation / published index
4. **Business Pipelines**：page / ask / research 只负责业务编排
5. **Tool Registry**：只负责工具定义与执行策略

只要做到了这五层，RepoRead 后续复杂度即使上涨，也不会变成 Claude Code 或 OMO 那种“功能是加上去了，但心智中心变得模糊”。

---

## 10. 给 RepoRead 的升级路线

## 10.1 P0：先补“运行时控制平面”

这是最优先的，不做这个，后面的优化都会继续散落。

### 建议动作

1. 引入统一 `TurnEngine`
   - 统一 page / ask / research 的 step loop
   - 统一 retry、overflow、continuation、tool batch 策略
2. 引入 `PromptAssembler`
   - base / developer / contextual user / tool appendix / role appendix 分层
3. 引入 `ContextManager`
   - 不只管理 page artifact，也管理会话历史和 compact baseline

### 直接借鉴对象

- 结构：`Codex`
- 行为：`Claude Code`

## 10.2 P1：补“上下文治理”

### 建议动作

1. 问答链从最近 4 轮改为可压缩历史
2. 研究链引入持久化摘要与 replay 基线
3. tool output 先做 truncation / externalization，再决定是否入 prompt
4. 对 prompt-too-long / max_output_tokens 做统一恢复策略

### 直接借鉴对象

- 轻量版先学 `OpenCode`
- 完整版再学 `Claude Code` + `Codex`

## 10.3 P2：补“配置与模型路由”

### 建议动作

1. 做 config layering 与 provenance
2. 把 provider capability、fallback chain、role route 变成正式解析层
3. 区分“用户可配项”和“系统内建策略”

### 直接借鉴对象

- `Codex` 的 config layering
- `OpenCode` / `oh-my-openagent` 的 provider fallback 经验

## 10.4 P3：补“有限扩展性”，而不是平台化

### 可以做

- MCP adapter
- 简单 SDK / internal server boundary
- reviewer/background worker mailbox

### 先不要做

- 全量 plugin marketplace
- 大而全多客户端协议面
- 复杂 hook 系统
- 通用自治 coding swarm

RepoRead 的差异化仍然应该是：

> 页面化代码阅读、证据账本、独立 reviewer、版本化 wiki、页面内继续 ask / research 的闭环。

---

## 11. 建议吸收与明确回避

### 11.1 应该直接吸收

- **Claude Code**
  - prompt section 化
  - compact / overflow / tool batch 的运行时治理
  - tool 并发安全分类
- **Codex**
  - core/runtime/protocol/config/tools 的分层方式
  - context manager + compaction baseline
  - 多 agent / approval / app-server 的强类型建模方式
- **OpenCode**
  - provider-agnostic 模型接入
  - tool registry + plugin injection 的边界感
  - client/server 分离的产品思路
- **oh-my-openagent**
  - background task / continuation / fallback 的执行意识
  - skill + MCP 按需联动
  - category-based delegation 的实战经验

### 11.2 应该明确回避

- **不要学 Claude Code 的问题**
  - 巨型文件
  - 过多 feature flag 造成的可读性下降
- **不要学 Codex 的问题**
  - 在需求还没出现时就过早铺满整套协议面
- **不要学 OpenCode 的问题**
  - 让 session/prompt 文件继续膨胀成单点大文件
- **不要学 oh-my-openagent 的问题**
  - 用 hook 层叠加替代内核能力
  - 让 prompt / fallback / background / tool policy 分散到太多入口

---

## 12. 每个项目具体“怎么学”

这一节把“学习方法”再落到五个具体项目上，避免方法论过抽象。

### 12.1 RepoRead：学自己的瓶颈，不是学自己的实现

读 RepoRead 时，不是为了再次熟悉现状，而是为了定位“最先该拆哪一层”。

#### 建议读法

1. 从 `packages/core/src/generation/generation-pipeline.ts` 开始
2. 标出其中分别属于：
   - business pipeline
   - turn loop
   - prompt assembly
   - artifact persistence
   - retry / feedback / validation
3. 再回到 `agent-loop.ts`、`AskService`、`ResearchService`
4. 看三条链之间哪些 runtime 能力重复、哪些缺失

#### 要学出的东西

- RepoRead 的主问题不是 prompt 文案不够好，而是 **控制平面还没抽出来**
- RepoRead 已有最宝贵的资产是：
  - 页面化产物
  - evidence ledger
  - reviewer 独立审稿
  - pointer-first 的方向

#### 不要做的事

- 不要继续在 `generation-pipeline.ts` 里叠更多策略
- 不要在没有统一 runtime 前先加复杂 fallback / compact 逻辑

### 12.2 Claude Code：学“运行时治理”，不要学“产品包袱”

#### 建议读法

先读：

1. `src/utils/systemPrompt.ts`
2. `src/constants/prompts.ts`
3. `src/query.ts`
4. `src/QueryEngine.ts`
5. `src/services/compact/*`

读的时候专门回答：

1. system prompt 是怎么分层的？
2. query loop 内有哪些统一处理点？
3. compact 为什么能挂在运行时里，而不是业务链里？
4. tool 并发策略是怎么做分类的？

#### 要学出的东西

- 如何把 prompt、tool、compact、budget、retry 都挂到同一 turn runtime
- 如何在系统层区分：
  - cached vs dynamic prompt
  - read-only vs mutating tools
  - proactive compact vs reactive recovery

#### 不该学的部分

- feature flag 密布
- 产品历史兼容层
- 大文件继续膨胀的组织方式

#### 正确迁移方式

不是抄它的代码，而是把它抽象成三件事：

1. `Prompt Assembly`
2. `Turn Runtime`
3. `Context Governance`

### 12.3 Codex：学“内核分层”，不要急着学“全协议面”

#### 建议读法

先读：

1. `codex-rs/core/src/codex.rs`
2. `codex-rs/core/src/context_manager/history.rs`
3. `codex-rs/core/src/compact.rs`
4. `codex-rs/tools/src/tool_registry_plan.rs`
5. `codex-rs/config/*`
6. 最后再看 `app-server/*`、`codex-api/*`

#### 读的时候重点看

1. 为什么 `core`、`tools`、`protocol`、`config` 要拆开？
2. prompt、permissions、collaboration mode 为什么都被协议化？
3. compact 为什么要改写 history，而不是只产出 summary？
4. tool registry 为什么能 declarative？

#### 要学出的东西

- 什么叫真正的 runtime core
- 什么叫强类型配置层
- 什么叫协议层先行，而不是业务代码顺手带出协议

#### 不该学的部分

- 在 RepoRead 现在这个阶段就把 app-server / realtime / sdk 全套都铺出来

#### 正确迁移方式

先只迁移三件最值钱的抽象：

1. `Config Layering`
2. `ContextManager`
3. `Declarative Tool Registry`

### 12.4 OpenCode：学“开放运行时”，不要学“大文件收口”

#### 建议读法

先读：

1. `packages/opencode/src/session/prompt.ts`
2. `packages/opencode/src/session/processor.ts`
3. `packages/opencode/src/tool/registry.ts`
4. `packages/opencode/src/provider/provider.ts`
5. `packages/opencode/src/mcp/index.ts`
6. `packages/opencode/src/config/config.ts`

#### 读的时候重点看

1. provider abstraction 是怎么做成一等对象的？
2. plugin/tool 是怎么被统一注册进 session runtime 的？
3. compaction agent 是怎么插入主链路的？
4. instruction file discovery 如何进 system prompt？

#### 要学出的东西

- provider-agnostic 不是“支持多个模型”这么简单，而是：
  - provider
  - model
  - tool exposure
  - format transform
  - MCP
  都要能被 runtime 消化

#### 不该学的部分

- 让 `session/prompt.ts` 继续承担太多职责

#### 正确迁移方式

对 RepoRead 来说，OpenCode 最值得学习的是：

1. provider 抽象如何与 tool / prompt / session 接起来
2. registry 如何承接内置工具和扩展工具

### 12.5 oh-my-openagent：学“执行策略”，不要学“横切复杂度”

#### 建议读法

先读：

1. `src/index.ts`
2. `src/create-managers.ts`
3. `src/tools/delegate-task/*`
4. `src/features/background-agent/*`
5. `src/hooks/preemptive-compaction.ts`
6. `src/hooks/runtime-fallback/*`
7. `src/features/skill-mcp-manager/*`

#### 读的时候重点看

1. 它是如何增强宿主执行欲的？
2. 如何让 subagent / background task / fallback 真正跑起来？
3. skill 和 MCP 为什么能按任务动态绑定？

#### 要学出的东西

- continuation 不是 prompt 口号，而是：
  - timeout
  - idle detection
  - fallback retry
  - background manager
  - task lifecycle

#### 不该学的部分

- 不要把所有增强能力都做成 hook
- 不要让 manager / hook / tool / prompt builder 相互缠绕

#### 正确迁移方式

RepoRead 只应吸收它的“策略意识”：

1. reviewer / worker 是否需要后台化
2. evidence retry 是否要更主动
3. skill/MCP 是否应按任务按需暴露

而不要吸收它的“横切注入式架构”。

---

## 13. 如何把“学到的东西”迁移进 RepoRead

这是最关键的一节。没有迁移方法，学习最后还是会退化成“知道很多但做不动”。

### 13.1 采用“机制迁移”，不要做“代码抄写”

每次只允许迁移一种机制，例如：

- `PromptAssembler`
- `TurnEngine`
- `ContextManager`
- `ToolRegistry`

不要一次把一整个项目的一大块实现搬过来。

### 13.2 每次迁移都做四步

#### 第一步：写出原问题

先明确 RepoRead 当前具体痛点，例如：

- `generation-pipeline.ts` 混合了 runtime 和业务编排
- ask/research 没有统一 context governance
- prompt 没有统一 layering

#### 第二步：标出参考实现的“最小机制”

例如不是写：

- “参考 Codex”

而是写：

- “参考 Codex 的 `ContextManager + compact baseline` 机制”

#### 第三步：做 RepoRead 版本的缩小设计

每个外部设计迁移进 RepoRead 时，先缩小一版：

- Claude Code 的 compact，不要一开始做四层
- Codex 的 protocol，不要一开始做 app-server
- OpenCode 的 provider 系统，不要一开始做全平台客户端
- OMO 的 background manager，不要一开始做 tmux orchestration

#### 第四步：明确“这次不做什么”

每次设计都必须附带一个“不做列表”，例如：

- 本次只引入 `TurnEngine`，不引入多客户端协议
- 本次只引入 `ContextManager`，不引入自动 compact
- 本次只引入 provider route，不引入 plugin marketplace

这一步非常重要，它决定 RepoRead 不会被外部项目的复杂度带跑偏。

### 13.3 用“阅读产物”驱动代码迁移

推荐以后每引入一个外部机制，都先在 docs 中落三份小文档：

1. `problem.md`
   - RepoRead 当前为什么需要它
2. `borrowed-mechanism.md`
   - 外部项目里这个机制到底是什么
3. `reporead-adaptation.md`
   - RepoRead 只吸收哪一部分

只有三份都写清楚，再动代码。

### 13.4 一个简单的判断标准

如果一个“借鉴”动作做完后，RepoRead 的开发者还说不清：

- 这个能力属于哪一层
- 它解决哪个具体问题
- 它依赖哪些前置抽象

那说明这次不是在学习，而是在拼贴。

---

## 14. 最终判断

RepoRead 当前最需要的不是“再加几个 agent”，也不是“补更多 prompt 技巧”，而是把自己从：

> 一个写 wiki 的 pipeline

升级成：

> 一个有清晰 runtime / context / prompt / artifact 边界的专用代码阅读 agent

如果只保留一条主线，那么我建议是：

1. **先学 Codex 的分层**
2. **再学 Claude Code 的运行时治理**
3. **用 OpenCode 的开放性补 provider/tool registry**
4. **只选择性吸收 oh-my-openagent 的执行策略，不吸它的 hook 复杂度**

对 RepoRead 来说，最优解不是“变成另一个通用 coding agent”，而是：

> 在保持页面化阅读与写作优势的前提下，长出一个足够强但不过度平台化的 agent runtime。
