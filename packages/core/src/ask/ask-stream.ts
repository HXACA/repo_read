import * as fs from "node:fs/promises";
import { streamText, stepCountIs } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { WikiJson, PageMeta, CitationRecord } from "../types/generation.js";
import { createCatalogTools } from "../catalog/catalog-tools.js";
import { classifyRoute } from "./route-classifier.js";
import { AskSessionManager } from "./ask-session.js";

export type AskStreamOptions = {
  model: LanguageModel;
  storage: StorageAdapter;
  repoRoot: string;
  language?: string;
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

  constructor(options: AskStreamOptions) {
    this.model = options.model;
    this.storage = options.storage;
    this.repoRoot = options.repoRoot;
    this.language = options.language ?? "zh";
    this.sessionManager = new AskSessionManager(options.storage);
  }

  async *ask(
    projectSlug: string,
    versionId: string,
    question: string,
    opts?: { currentPageSlug?: string; sessionId?: string },
  ): AsyncGenerator<AskStreamEvent> {
    // Session setup
    let session = opts?.sessionId
      ? this.sessionManager.get(opts.sessionId)
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

    const systemPrompt = this.buildSystemPrompt(route);
    const userPrompt = this.buildUserPrompt(
      question,
      pageContent,
      wiki,
      session.turns,
    );

    const tools = createCatalogTools(this.repoRoot);

    let fullText = "";
    const citations: CitationRecord[] = [];

    try {
      const result = streamText({
        model: this.model,
        system: systemPrompt,
        prompt: userPrompt,
        tools: tools as unknown as ToolSet,
        stopWhen: stepCountIs(10),
      });

      for await (const part of result.fullStream) {
        switch (part.type) {
          case "reasoning-delta":
            yield {
              type: "reasoning-delta",
              text: (part as { text: string }).text,
            };
            break;
          case "text-delta": {
            const delta = (part as { text: string }).text;
            fullText += delta;
            yield { type: "text-delta", text: delta };
            break;
          }
          case "tool-call":
            yield {
              type: "tool-call",
              toolName: (part as { toolName: string }).toolName,
              input: (part as { input?: unknown }).input,
            };
            break;
          case "tool-result":
            yield {
              type: "tool-result",
              toolName: (part as { toolName: string }).toolName,
            };
            break;
          case "error":
            yield {
              type: "error",
              message: String((part as { error: unknown }).error),
            };
            break;
        }
      }

      // Parse citations from final text, then sanitize the answer body
      const parsed = this.parseCitations(fullText);
      const cleanAnswer = this.sanitizeAnswer(parsed.answer);
      citations.push(...parsed.citations);

      this.sessionManager.addAssistantTurn(
        session.id,
        cleanAnswer,
        citations,
      );
      await this.sessionManager.persist(session.id);

      yield { type: "citations", citations };
      yield { type: "done" };
    } catch (err) {
      yield { type: "error", message: (err as Error).message };
    }
  }

  private buildSystemPrompt(route: string): string {
    const zh = this.language === "zh";

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

现在回答用户的问题。记住：**简短、精准、必须引用**。`;

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

Now answer the user. Remember: **short, precise, cited**.`;

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
