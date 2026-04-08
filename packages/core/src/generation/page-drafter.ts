import { generateText } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import type { MainAuthorContext } from "../types/agent.js";
import type { CitationRecord } from "../types/generation.js";
import { buildPageDraftSystemPrompt, buildPageDraftUserPrompt } from "./page-drafter-prompt.js";
import type { PageDraftPromptInput } from "./page-drafter-prompt.js";
import { createCatalogTools } from "../catalog/catalog-tools.js";

export type PageDraftResult = {
  success: boolean;
  markdown?: string;
  metadata?: {
    summary: string;
    citations: CitationRecord[];
    related_pages: string[];
  };
  error?: string;
};

export type PageDrafterOptions = {
  model: LanguageModel;
  repoRoot: string;
};

export class PageDrafter {
  private readonly model: LanguageModel;
  private readonly repoRoot: string;

  constructor(options: PageDrafterOptions) {
    this.model = options.model;
    this.repoRoot = options.repoRoot;
  }

  async draft(
    context: MainAuthorContext,
    input: PageDraftPromptInput,
  ): Promise<PageDraftResult> {
    const systemPrompt = buildPageDraftSystemPrompt();
    const userPrompt = buildPageDraftUserPrompt(context, input);
    const tools = createCatalogTools(this.repoRoot);

    try {
      const result = await generateText({
        model: this.model,
        system: systemPrompt,
        prompt: userPrompt,
        tools: tools as unknown as ToolSet,
      });

      return this.parseOutput(result.text);
    } catch (err) {
      return { success: false, error: `Page drafting failed: ${(err as Error).message}` };
    }
  }

  private parseOutput(text: string): PageDraftResult {
    const jsonMatch = text.match(/```json\s*\n([\s\S]*?)\n```\s*$/);
    if (!jsonMatch) {
      return { success: false, error: "Page output missing JSON metadata block" };
    }

    try {
      const metadata = JSON.parse(jsonMatch[1]);
      if (!metadata.summary || !Array.isArray(metadata.citations)) {
        return { success: false, error: "Invalid metadata: missing summary or citations" };
      }

      const markdown = text.slice(0, jsonMatch.index).trim();

      return {
        success: true,
        markdown,
        metadata: {
          summary: metadata.summary,
          citations: metadata.citations.map((c: Record<string, string>) => ({
            kind: c.kind ?? "file",
            target: c.target,
            locator: c.locator,
            note: c.note,
          })),
          related_pages: metadata.related_pages ?? [],
        },
      };
    } catch {
      return { success: false, error: "Failed to parse JSON metadata block" };
    }
  }
}
