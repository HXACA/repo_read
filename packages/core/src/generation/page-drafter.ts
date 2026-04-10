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
  /**
   * True if the LLM stopped because it hit the output token ceiling
   * (finishReason === "length"). The pipeline uses this to force a
   * "shorten the page" retry cycle before the reviewer runs.
   */
  truncated?: boolean;
};

export type PageDrafterOptions = {
  model: LanguageModel;
  repoRoot: string;
  /** Upper bound on tool-call steps within a single draft run. Defaults to 20. */
  maxSteps?: number;
  /**
   * Upper bound on output tokens for the final assistant message. Defaults
   * to 16384, which gives roughly 2× headroom over Claude's default 8192
   * and comfortably fits a full-length page + mermaid + JSON metadata.
   * If the model still hits this limit the draft is marked `truncated`
   * and the pipeline triggers a "shorten it" revise loop.
   */
  maxOutputTokens?: number;
};

/**
 * Strip LLM "chain-of-thought" artifacts that sometimes wrap the real
 * page content:
 *
 *   1. A preamble line like "Now I have all the necessary information.
 *      Let me write the page." that the model produces before switching
 *      into output mode.
 *   2. An outer ```markdown … ``` fence that Claude often wraps the entire
 *      answer in when it has been given a revision instruction.
 *
 * The trailing ```json metadata block is preserved so `parseOutput` can
 * still pull citations/summary out of it.
 *
 * Exported for unit testing.
 */
export function stripDraftOutputWrappers(raw: string): string {
  let text = raw;

  // Step 1 — drop any leading text that appears before the FIRST of either
  // (a) a line beginning with "# " (a real heading) or
  // (b) a ```markdown fence opener.
  //
  // Whichever comes first is treated as "where the real content begins".
  const headingIdx = text.search(/^#\s/m);
  const fenceIdx = text.indexOf("```markdown");
  const candidates = [headingIdx, fenceIdx].filter((i) => i >= 0);
  const startIdx = candidates.length > 0 ? Math.min(...candidates) : -1;
  if (startIdx > 0) {
    text = text.slice(startIdx);
  }

  // Step 2 — if the content now starts with an outer ```markdown fence,
  // strip the opener and the matching closer. The closer is the ``` that
  // appears immediately before the trailing ```json metadata block (if
  // present) or at the very end of the text otherwise.
  if (text.startsWith("```markdown")) {
    text = text.replace(/^```markdown[^\n]*\n/, "");
    // Case A: closing ``` sits between the markdown body and the ```json block
    text = text.replace(/\n```(\s*\n+```json)/, "$1");
    // Case B: no ```json block — strip the final ``` at EOF
    if (!/```json\s*\n[\s\S]*?\n```\s*$/.test(text)) {
      text = text.replace(/\n```\s*$/, "\n");
    }
  }

  return text.trim();
}

export class PageDrafter {
  private readonly model: LanguageModel;
  private readonly repoRoot: string;
  private readonly maxSteps: number;
  private readonly maxOutputTokens: number;

  constructor(options: PageDrafterOptions) {
    this.model = options.model;
    this.repoRoot = options.repoRoot;
    this.maxSteps = options.maxSteps ?? 20;
    this.maxOutputTokens = options.maxOutputTokens ?? 16384;
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
        maxOutputTokens: this.maxOutputTokens,
      });

      const parsed = this.parseOutput(result.text);
      // Surface truncation so the pipeline can force a "shorten it" retry
      // before calling the reviewer on half-written content.
      const finishReason = (result as { finishReason?: string }).finishReason;
      if (finishReason === "length") {
        parsed.truncated = true;
      }
      return parsed;
    } catch (err) {
      return { success: false, error: `Page drafting failed: ${(err as Error).message}` };
    }
  }

  private parseOutput(text: string): PageDraftResult {
    // Strip LLM preamble + outer ```markdown fence before any JSON parsing
    const cleaned = stripDraftOutputWrappers(text);

    // Try to find JSON metadata block (code fence at end)
    const jsonMatch = cleaned.match(/```json\s*\n([\s\S]*?)\n```\s*$/);
    let markdown: string;
    let metadata: Record<string, unknown> | null;

    if (jsonMatch) {
      markdown = cleaned.slice(0, jsonMatch.index).trim();
      try {
        metadata = JSON.parse(jsonMatch[1]);
      } catch {
        metadata = extractJson(jsonMatch[1]);
      }
    } else {
      metadata = extractJson(cleaned);
      if (metadata) {
        const braceStart = cleaned.lastIndexOf("{");
        markdown = cleaned.slice(0, braceStart).trim();
      } else {
        markdown = cleaned.trim();
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
