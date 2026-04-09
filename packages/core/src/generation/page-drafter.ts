import { generateText, stepCountIs } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import type { MainAuthorContext } from "../types/agent.js";
import type { CitationRecord } from "../types/generation.js";
import { buildPageDraftSystemPrompt, buildPageDraftUserPrompt } from "./page-drafter-prompt.js";
import type { PageDraftPromptInput } from "./page-drafter-prompt.js";
import { createCatalogTools } from "../catalog/catalog-tools.js";
import { extractJson } from "../utils/extract-json.js";

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
  /** Upper bound on tool-call steps within a single draft run. Defaults to 20. */
  maxSteps?: number;
};

export class PageDrafter {
  private readonly model: LanguageModel;
  private readonly repoRoot: string;
  private readonly maxSteps: number;

  constructor(options: PageDrafterOptions) {
    this.model = options.model;
    this.repoRoot = options.repoRoot;
    this.maxSteps = options.maxSteps ?? 20;
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
        stopWhen: stepCountIs(this.maxSteps),
      });

      return this.parseOutput(result.text);
    } catch (err) {
      return { success: false, error: `Page drafting failed: ${(err as Error).message}` };
    }
  }

  private parseOutput(text: string): PageDraftResult {
    // Try to find JSON metadata block (code fence at end)
    const jsonMatch = text.match(/```json\s*\n([\s\S]*?)\n```\s*$/);
    let markdown: string;
    let metadata: Record<string, unknown> | null;

    if (jsonMatch) {
      markdown = text.slice(0, jsonMatch.index).trim();
      try {
        metadata = JSON.parse(jsonMatch[1]);
      } catch {
        metadata = extractJson(jsonMatch[1]);
      }
    } else {
      metadata = extractJson(text);
      if (metadata) {
        const braceStart = text.lastIndexOf("{");
        markdown = text.slice(0, braceStart).trim();
      } else {
        markdown = text.trim();
        metadata = { summary: markdown.slice(0, 200), citations: [], related_pages: [] };
      }
    }

    if (!metadata) {
      return {
        success: true,
        markdown,
        metadata: { summary: markdown.slice(0, 200), citations: [], related_pages: [] },
      };
    }

    return {
      success: true,
      markdown,
      metadata: {
        summary: (metadata.summary as string) ?? markdown.slice(0, 200),
        citations: (Array.isArray(metadata.citations) ? metadata.citations : []).map(
          (c: Record<string, unknown>) => ({
            kind: (c.kind as string) ?? "file",
            target: c.target as string,
            locator: c.locator as string | undefined,
            note: c.note as string | undefined,
          }),
        ) as CitationRecord[],
        related_pages: (metadata.related_pages as string[]) ?? [],
      },
    };
  }
}
