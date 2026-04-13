import * as fs from "node:fs/promises";
import type { LanguageModel, ToolSet } from "ai";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { WikiJson, PageMeta, CitationRecord } from "../types/generation.js";
import type { QualityProfile } from "../config/quality-profile.js";
import { createCatalogTools } from "../catalog/catalog-tools.js";
import { classifyRoute } from "./route-classifier.js";
import { AskSessionManager } from "./ask-session.js";
import type { AskSession } from "../types/events.js";
import { PromptAssembler } from "../prompt/assembler.js";
import { TurnEngineAdapter } from "../runtime/turn-engine.js";

export type AskOptions = {
  model: LanguageModel;
  storage: StorageAdapter;
  repoRoot: string;
  language?: string;
  qualityProfile?: QualityProfile;
  allowBash?: boolean;
};

export type AskResult = {
  answer: string;
  citations: CitationRecord[];
  route: string;
  sessionId: string;
};

export class AskService {
  private readonly model: LanguageModel;
  private readonly storage: StorageAdapter;
  private readonly repoRoot: string;
  private readonly sessionManager: AskSessionManager;
  private readonly language: string;
  private readonly qualityProfile?: QualityProfile;
  private readonly allowBash: boolean;
  private readonly promptAssembler = new PromptAssembler();
  private readonly turnEngine = new TurnEngineAdapter();

  constructor(options: AskOptions) {
    this.model = options.model;
    this.storage = options.storage;
    this.repoRoot = options.repoRoot;
    this.language = options.language ?? "zh";
    this.sessionManager = new AskSessionManager(options.storage);
    this.allowBash = options.allowBash ?? true;
    this.qualityProfile = options.qualityProfile;
  }

  async ask(
    projectSlug: string,
    versionId: string,
    question: string,
    options?: { currentPageSlug?: string; sessionId?: string },
  ): Promise<AskResult> {
    // Get or create session
    let session: AskSession;
    if (options?.sessionId) {
      const existing = await this.sessionManager.get(options.sessionId, projectSlug);
      if (existing) {
        session = existing;
      } else {
        session = this.sessionManager.create(projectSlug, versionId, options?.currentPageSlug);
      }
    } else {
      session = this.sessionManager.create(projectSlug, versionId, options?.currentPageSlug);
    }

    // Classify route
    let pageMeta: PageMeta | null = null;
    if (options?.currentPageSlug) {
      pageMeta = await this.storage.readJson<PageMeta>(
        this.storage.paths.versionPageMeta(projectSlug, versionId, options.currentPageSlug),
      );
    }

    const wiki = await this.storage.readJson<WikiJson>(
      this.storage.paths.versionWikiJson(projectSlug, versionId),
    );

    const route = classifyRoute({
      question,
      currentPageSlug: options?.currentPageSlug,
      pageMeta,
      wiki,
    });

    // Build context
    let pageContent = "";
    if (options?.currentPageSlug) {
      try {
        pageContent = await fs.readFile(
          this.storage.paths.versionPageMd(projectSlug, versionId, options.currentPageSlug),
          "utf-8",
        );
      } catch {
        // Page not found, proceed without it
      }
    }

    // Add user turn
    this.sessionManager.addUserTurn(session.id, question);

    // Build prompt
    const systemPrompt = this.buildSystemPrompt(route);
    const userPrompt = this.buildUserPrompt(question, pageContent, wiki, session);
    const assembled = this.promptAssembler.assemble({ role: "ask", language: this.language, systemPrompt, userPrompt });

    // Call LLM
    const tools = createCatalogTools(this.repoRoot, { allowBash: this.allowBash });

    const askBudget = this.qualityProfile?.askMaxSteps ?? 10;

    try {
      const result = await this.turnEngine.run({
        purpose: "ask",
        model: this.model,
        systemPrompt: assembled.system,
        userPrompt: assembled.user,
        tools: tools as unknown as ToolSet,
        policy: {
          maxSteps: askBudget,
          providerOptions: { cacheKey: `ask-${session.id}` },
        },
      });

      const { answer, citations } = this.parseAnswer(result.text);

      this.sessionManager.addAssistantTurn(session.id, answer, citations);
      await this.sessionManager.persist(session.id);

      return { answer, citations, route, sessionId: session.id };
    } catch (err) {
      const errorAnswer = `I encountered an error while answering: ${(err as Error).message}`;
      this.sessionManager.addAssistantTurn(session.id, errorAnswer, []);
      return { answer: errorAnswer, citations: [], route, sessionId: session.id };
    }
  }

  private buildSystemPrompt(route: string): string {
    return `You are a helpful assistant answering questions about a codebase wiki.

Route: ${route}

Rules:
1. Answer based on the wiki page content and repository evidence.
2. Include inline citations in format [cite:kind:target:locator].
3. If the answer is in the current page, cite the page.
4. If you need more evidence, use retrieval tools (Read, Grep, Find, Git).
5. Be concise and accurate.
6. At the end, output a JSON block with citations:

\`\`\`json
{
  "citations": [
    { "kind": "file", "target": "path", "locator": "10-20", "note": "description" }
  ]
}
\`\`\``;
  }

  private buildUserPrompt(
    question: string,
    pageContent: string,
    wiki: WikiJson | null,
    session: AskSession,
  ): string {
    const parts: string[] = [];

    if (wiki) {
      parts.push(`## Wiki Summary\n${wiki.summary}`);
    }

    if (pageContent) {
      parts.push(`## Current Page Content\n${pageContent}`);
    }

    // Include recent conversation turns for context
    if (session.turns.length > 0) {
      const recentTurns = session.turns.slice(-4);
      parts.push("## Recent Conversation");
      for (const turn of recentTurns) {
        parts.push(`**${turn.role}:** ${turn.content}`);
      }
    }

    parts.push(`## Question\n${question}`);
    parts.push("Answer the question using the page content and tools. End with a JSON citations block.");

    return parts.join("\n\n");
  }

  private parseAnswer(text: string): { answer: string; citations: CitationRecord[] } {
    const jsonMatch = text.match(/```json\s*\n([\s\S]*?)\n```\s*$/);

    let citations: CitationRecord[] = [];
    let answer = text;

    if (jsonMatch) {
      answer = text.slice(0, jsonMatch.index).trim();
      try {
        const parsed = JSON.parse(jsonMatch[1]) as { citations?: Record<string, string>[] };
        if (Array.isArray(parsed.citations)) {
          citations = parsed.citations.map((c: Record<string, string>) => ({
            kind: (c.kind ?? "file") as CitationRecord["kind"],
            target: c.target,
            locator: c.locator,
            note: c.note,
          }));
        }
      } catch {
        // Keep answer as-is without citations
      }
    }

    return { answer, citations };
  }
}
