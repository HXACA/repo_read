import * as fs from "node:fs/promises";
import type { LanguageModel, ToolSet } from "ai";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { WikiJson, PageMeta, CitationRecord } from "../types/generation.js";
import type { QualityProfile } from "../config/quality-profile.js";
import { createCatalogTools } from "../catalog/catalog-tools.js";
import { classifyRoute, type AskRoute } from "./route-classifier.js";
import { AskSessionManager } from "./ask-session.js";
import { ResearchService } from "../research/research-service.js";
import { runAgentLoopStream } from "../agent/agent-loop.js";
import type { AgentLoopEvent } from "../agent/agent-loop.js";
import { setCacheKey, setModelOptions } from "../utils/generate-via-stream.js";
import type { LabeledFinding } from "../types/research.js";

export type AskStreamOptions = {
  model: LanguageModel;
  storage: StorageAdapter;
  repoRoot: string;
  language?: string;
  /**
   * Quality profile controls per-route step budgets. When omitted, a
   * conservative default of 10 steps is used for all routes (matches the
   * previous hardcoded behavior).
   */
  qualityProfile?: QualityProfile;
};

export type AskStreamEvent =
  | { type: "session"; sessionId: string; route: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolName: string; input: unknown }
  | { type: "tool-result"; toolName: string }
  | { type: "citations"; citations: CitationRecord[] }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * Streaming version of AskService. Yields events as the LLM generates them.
 */
export class AskStreamService {
  private readonly model: LanguageModel;
  private readonly storage: StorageAdapter;
  private readonly repoRoot: string;
  private readonly language: string;
  private readonly sessionManager: AskSessionManager;
  private readonly qualityProfile?: QualityProfile;

  constructor(options: AskStreamOptions) {
    this.model = options.model;
    this.storage = options.storage;
    this.repoRoot = options.repoRoot;
    this.language = options.language ?? "zh";
    this.sessionManager = new AskSessionManager(options.storage);
    this.qualityProfile = options.qualityProfile;
  }

  async *ask(
    projectSlug: string,
    versionId: string,
    question: string,
    opts?: { currentPageSlug?: string; sessionId?: string },
  ): AsyncGenerator<AskStreamEvent> {
    // Session setup
    let session = opts?.sessionId
      ? await this.sessionManager.get(opts.sessionId, projectSlug)
      : null;
    if (!session) {
      session = this.sessionManager.create(
        projectSlug,
        versionId,
        opts?.currentPageSlug,
      );
    }

    // Load context
    let pageMeta: PageMeta | null = null;
    if (opts?.currentPageSlug) {
      pageMeta = await this.storage.readJson<PageMeta>(
        this.storage.paths.versionPageMeta(
          projectSlug,
          versionId,
          opts.currentPageSlug,
        ),
      );
    }

    const wiki = await this.storage.readJson<WikiJson>(
      this.storage.paths.versionWikiJson(projectSlug, versionId),
    );

    const route = classifyRoute({
      question,
      currentPageSlug: opts?.currentPageSlug,
      pageMeta,
      wiki,
    });

    yield { type: "session", sessionId: session.id, route };

    let pageContent = "";
    if (opts?.currentPageSlug) {
      try {
        pageContent = await fs.readFile(
          this.storage.paths.versionPageMd(
            projectSlug,
            versionId,
            opts.currentPageSlug,
          ),
          "utf-8",
        );
      } catch {
        /* page not found */
      }
    }

    this.sessionManager.addUserTurn(session.id, question);

    // Set cache/routing state so Responses API calls get promptCacheKey + session_id header
    setCacheKey(`ask-${session.id}`);
    setModelOptions({ reasoning: null, serviceTier: null });

    try {
      if (route === "research") {
        yield* this.runResearchRoute(
          projectSlug,
          versionId,
          question,
          session.id,
        );
        return;
      }

      yield* this.runStreamingRoute(
        route,
        question,
        pageContent,
        wiki,
        session.id,
        session.turns,
      );
    } catch (err) {
      yield { type: "error", message: (err as Error).message };
    }
  }

  /**
   * Streaming ask for `page-first` and `page-plus-retrieval`. The two
   * routes differ in tool exposure and step budget:
   *
   * - `page-first` gets no tools and a tiny budget. The answer must come
   *   from the current page content already in the user prompt. If the
   *   model can't answer from the page, it should say so — not fabricate.
   * - `page-plus-retrieval` gets the full catalog toolset and the profile
   *   budget. The page is the starting point but the model may explore.
   */
  private async *runStreamingRoute(
    route: AskRoute,
    question: string,
    pageContent: string,
    wiki: WikiJson | null,
    sessionId: string,
    turns: Array<{ role: string; content: string }>,
  ): AsyncGenerator<AskStreamEvent> {
    const systemPrompt = this.buildSystemPrompt(route);
    const userPrompt = this.buildUserPrompt(
      question,
      pageContent,
      wiki,
      turns,
    );

    const profileAskBudget = this.qualityProfile?.askMaxSteps ?? 10;
    const isPageFirst = route === "page-first";
    const budget = isPageFirst ? 2 : profileAskBudget;
    const toolSet: ToolSet = isPageFirst
      ? ({} as ToolSet)
      : (createCatalogTools(this.repoRoot) as unknown as ToolSet);

    let fullText = "";
    const citations: CitationRecord[] = [];

    for await (const event of runAgentLoopStream(
      {
        model: this.model,
        system: systemPrompt,
        tools: toolSet as any,
        maxSteps: budget,
      },
      userPrompt,
    )) {
      switch (event.type) {
        case "text-delta":
          fullText += event.text;
          yield { type: "text-delta", text: event.text };
          break;
        case "reasoning-delta":
          yield { type: "reasoning-delta", text: event.text };
          break;
        case "tool-call":
          yield { type: "tool-call", toolName: event.name, input: event.args };
          break;
        case "tool-result":
          yield { type: "tool-result", toolName: event.name };
          break;
      }
    }

    const parsed = this.parseCitations(fullText);
    const cleanAnswer = this.sanitizeAnswer(parsed.answer);
    citations.push(...parsed.citations);

    this.sessionManager.addAssistantTurn(sessionId, cleanAnswer, citations);
    await this.sessionManager.persist(sessionId);

    yield { type: "citations", citations };
    yield { type: "done" };
  }

  /**
   * Research route delegates to {@link ResearchService}, which runs the
   * full plan → execute → synthesize pipeline and persists a
   * {@link ResearchNote}. The result is then streamed back as text-delta
   * chunks so the Web chat UI can render it progressively even though the
   * underlying work is not token-streaming.
   *
   * Note: this is a deliberate UX trade-off. True token streaming would
   * require plumbing streamText through every research sub-step, which is
   * significantly more invasive. For now, the user sees "thinking..." while
   * research runs, then the full three-label output arrives at once.
   */
  private async *runResearchRoute(
    projectSlug: string,
    versionId: string,
    question: string,
    sessionId: string,
  ): AsyncGenerator<AskStreamEvent> {
    const profile = this.qualityProfile;
    const researchBudget = profile?.researchMaxSteps ?? 15;
    const plannerBudget = Math.max(3, Math.ceil(researchBudget / 2));

    const service = new ResearchService({
      model: this.model,
      storage: this.storage,
      repoRoot: this.repoRoot,
      plannerMaxSteps: plannerBudget,
      executorMaxSteps: researchBudget,
    });

    // Signal to the UI that research is running so the thinking indicator
    // can show a distinct message. The model name is a reasonable proxy.
    yield {
      type: "tool-call",
      toolName: "research.plan",
      input: { topic: question },
    };

    const result = await service.research(projectSlug, versionId, question);

    yield { type: "tool-result", toolName: "research.plan" };

    const answerText = this.formatResearchAnswer(result.note.summary, {
      facts: result.note.facts,
      inferences: result.note.inferences,
      unconfirmed: result.note.unconfirmed,
    });

    // Stream the formatted text as a single chunk. The UI already handles
    // text-delta accumulation, so this gives a consistent rendering path.
    yield { type: "text-delta", text: answerText };

    // Flatten every citation from facts + inferences into the wire event.
    // unconfirmed entries have no citations by definition.
    const citations: CitationRecord[] = [];
    for (const f of result.note.facts) citations.push(...f.citations);
    for (const f of result.note.inferences) citations.push(...f.citations);

    this.sessionManager.addAssistantTurn(sessionId, answerText, citations);
    await this.sessionManager.persist(sessionId);

    yield { type: "citations", citations };
    yield { type: "done" };
  }

  /**
   * Format a ResearchNote's three buckets + summary into a compact ask
   * answer. Intentionally plain text — the sanitizer will strip heavier
   * markdown and the chat UI renders this as-is.
   */
  private formatResearchAnswer(
    summary: string,
    buckets: {
      facts: LabeledFinding[];
      inferences: LabeledFinding[];
      unconfirmed: LabeledFinding[];
    },
  ): string {
    const zh = this.language === "zh";
    const parts: string[] = [];

    if (summary.trim()) {
      parts.push(summary.trim());
    }

    if (buckets.facts.length > 0) {
      parts.push(zh ? "**事实**" : "**Facts**");
      for (const f of buckets.facts) {
        parts.push(`- ${f.statement}`);
      }
    }

    if (buckets.inferences.length > 0) {
      parts.push(zh ? "**推断**" : "**Inferences**");
      for (const f of buckets.inferences) {
        parts.push(`- ${f.statement}`);
      }
    }

    if (buckets.unconfirmed.length > 0) {
      parts.push(zh ? "**待确认**" : "**Unconfirmed**");
      for (const f of buckets.unconfirmed) {
        parts.push(`- ${f.statement}`);
      }
    }

    return parts.join("\n\n");
  }

  private buildSystemPrompt(route: AskRoute): string {
    const zh = this.language === "zh";
    const pageFirst = route === "page-first";

    const pageFirstGuardZh = pageFirst
      ? `

## 当前路由约束（page-first）
问题应当完全由「当前页面」内容回答。**不允许调用任何工具**。
如果页面里没有答案，直接回复"当前页面没有相关内容，请切换到相关页面或换一种问法"——**绝不编造**。`
      : "";
    const pageFirstGuardEn = pageFirst
      ? `

## Current Route Constraint (page-first)
The answer MUST come entirely from the "Current Page" content in the user prompt. **No tool calls allowed.**
If the page does not contain the answer, reply "This page does not contain relevant content; try a different page or rephrase" — never fabricate.`
      : "";

    const bodyZh = `你是代码仓库 wiki 的**检索助手**，不是文档作者。绝对禁止重写 wiki 内容。

## 语言
全程使用**简体中文**回答。代码、文件路径、API 名称保持原文。

## 输出硬性限制（违反任何一条视为失败）

1. **总字数 ≤ 200 字**（中文字符）。超过就停止。
2. **禁止使用**：\`#\` / \`##\` / \`###\` 标题；表格；引用块 \`>\`；分割线 \`---\`；多级嵌套列表。
3. **允许**：纯段落；最多 1 个不超过 4 项的平级列表；行内代码 \`code\`；最多 1 个 3 行以内代码块（仅当必要）。
4. 不要写 "这章的核心内容"、"让我进一步..."、"综上所述" 等引导/总结句。直接回答。
5. 不要复述用户的问题。

## 引用格式（严格）

- 文件：\`[cite:file:path/to/file.ts:10-20]\`
- Wiki 页：\`[cite:page:page-slug]\`（**只用 slug，没有行号**）
- commit：\`[cite:commit:abc1234]\`

每个事实都要有引用。没有证据就调用工具检索。

## 工具调用

先用 \`grep\` / \`find\` 定位，再用 \`read\` 精读。不确定就多调几次。置信度不够时绝不编造。

路由：${route}

## 输出结构

只输出**答案正文**（≤200 字）+ 末尾 JSON 引用块：

\`\`\`json
{
  "citations": [
    { "kind": "file", "target": "path/to/file.ts", "locator": "10-20", "note": "..." }
  ]
}
\`\`\`

现在回答用户的问题。记住：**简短、精准、必须引用**。${pageFirstGuardZh}`;

    const bodyEn = `You are a **retrieval assistant** for a codebase wiki, NOT a documentation writer. Never rewrite wiki content.

## Language
Respond in ${this.language}. Code, file paths, API names stay in original.

## Hard Output Limits (violating any = failure)

1. **Max 120 words** total. Stop when reached.
2. **Forbidden**: \`#\` / \`##\` / \`###\` headings; tables; block quotes \`>\`; horizontal rules \`---\`; nested lists.
3. **Allowed**: plain paragraphs; at most 1 flat list of ≤4 items; inline code \`code\`; at most 1 code block of ≤3 lines (only if essential).
4. No meta phrases like "the key point is", "let me investigate", "in summary". Answer directly.
5. Don't restate the user's question.

## Citation Format (strict)

- File: \`[cite:file:path/to/file.ts:10-20]\`
- Wiki page: \`[cite:page:page-slug]\` (slug only, NO line numbers)
- Commit: \`[cite:commit:abc1234]\`

Every fact needs a citation. If unsure, call a tool.

## Tool Calls

Use \`grep\` / \`find\` to locate, then \`read\` to pinpoint. Call multiple times if needed. Never fabricate.

Route: ${route}

## Output Structure

Output ONLY the answer body (≤120 words) + trailing JSON citations block:

\`\`\`json
{
  "citations": [
    { "kind": "file", "target": "path/to/file.ts", "locator": "10-20", "note": "..." }
  ]
}
\`\`\`

Now answer the user. Remember: **short, precise, cited**.${pageFirstGuardEn}`;

    return zh ? bodyZh : bodyEn;
  }

  /**
   * Post-process LLM answer to strip disallowed markdown structures.
   * The prompt forbids these, but models sometimes ignore rules.
   * This enforces them as a safety net.
   */
  private sanitizeAnswer(text: string): string {
    let out = text;

    // Strip top-level headings (# ## ###) — convert to bold text
    out = out.replace(/^(#{1,6})\s+(.+)$/gm, (_m, _hash, title) => {
      return `**${title.trim()}**`;
    });

    // Strip horizontal rules
    out = out.replace(/^---+$/gm, "");

    // Strip block quotes (>)
    out = out.replace(/^>\s?/gm, "");

    // Collapse multiple consecutive blank lines into one
    out = out.replace(/\n{3,}/g, "\n\n");

    return out.trim();
  }

  private buildUserPrompt(
    question: string,
    pageContent: string,
    wiki: WikiJson | null,
    turns: Array<{ role: string; content: string }>,
  ): string {
    const zh = this.language === "zh";
    const parts: string[] = [];

    if (wiki) {
      parts.push(
        zh ? `## Wiki 总览\n${wiki.summary}` : `## Wiki Summary\n${wiki.summary}`,
      );
    }
    if (pageContent) {
      parts.push(
        zh ? `## 当前页面\n${pageContent}` : `## Current Page\n${pageContent}`,
      );
    }

    if (turns.length > 0) {
      const recent = turns.slice(-4);
      parts.push(zh ? "## 最近对话" : "## Recent Conversation");
      for (const t of recent) {
        parts.push(`**${t.role}:** ${t.content}`);
      }
    }

    parts.push(zh ? `## 问题\n${question}` : `## Question\n${question}`);
    parts.push(
      zh
        ? "**要求**：答案 2-5 句话直达核心，禁止大段 Markdown 结构。优先使用 grep/find 检索证据，再用 read 精读定位行。每个事实都要有引用。末尾输出 JSON 引用块。"
        : "**Requirements**: Answer in 2-5 sentences, straight to the point. No large Markdown structures. Use grep/find to locate evidence first, then read to pinpoint lines. Every claim needs a citation. End with the JSON citations block.",
    );
    return parts.join("\n\n");
  }

  private parseCitations(text: string): {
    answer: string;
    citations: CitationRecord[];
  } {
    const jsonMatch = text.match(/```json\s*\n([\s\S]*?)\n```\s*$/);
    if (!jsonMatch) return { answer: text, citations: [] };

    const answer = text.slice(0, jsonMatch.index).trim();
    try {
      const parsed = JSON.parse(jsonMatch[1]) as {
        citations?: Array<Record<string, string>>;
      };
      const citations: CitationRecord[] = (parsed.citations ?? []).map((c) => ({
        kind: (c.kind ?? "file") as CitationRecord["kind"],
        target: c.target,
        locator: c.locator,
        note: c.note,
      }));
      return { answer, citations };
    } catch {
      return { answer, citations: [] };
    }
  }
}
