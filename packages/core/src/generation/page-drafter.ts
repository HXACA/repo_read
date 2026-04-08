import * as fsPromises from "node:fs/promises";
import * as nodePath from "node:path";
import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { MainAuthorContext } from "../types/agent.js";
import type { CitationRecord } from "../types/generation.js";
import { buildPageDraftSystemPrompt, buildPageDraftUserPrompt } from "./page-drafter-prompt.js";
import type { PageDraftPromptInput } from "./page-drafter-prompt.js";

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

    // Read covered files and embed their content in the prompt
    const fileContents = await this.readCoveredFiles(input.coveredFiles);
    const enrichedContext = {
      ...context,
      evidence_ledger: [
        ...context.evidence_ledger,
        ...fileContents.map((f, i) => ({
          id: `file-${i}`,
          kind: "file" as const,
          target: f.path,
          note: `${f.lines} lines`,
        })),
      ],
    };

    let userPrompt = buildPageDraftUserPrompt(enrichedContext, input);

    // Append file contents directly into the prompt
    if (fileContents.length > 0) {
      userPrompt += "\n\n## Source File Contents\n\n";
      for (const f of fileContents) {
        userPrompt += `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\`\n\n`;
      }
    }

    try {
      const result = await generateText({
        model: this.model,
        system: systemPrompt,
        prompt: userPrompt,
      });

      return this.parseOutput(result.text);
    } catch (err) {
      return { success: false, error: `Page drafting failed: ${(err as Error).message}` };
    }
  }

  private async readCoveredFiles(
    coveredFiles: string[],
  ): Promise<Array<{ path: string; content: string; lines: number }>> {
    const results: Array<{ path: string; content: string; lines: number }> = [];
    const MAX_LINES = 300;

    for (const filePath of coveredFiles) {
      try {
        const fullPath = nodePath.join(this.repoRoot, filePath);
        const content = await fsPromises.readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        const truncated = lines.length > MAX_LINES
          ? lines.slice(0, MAX_LINES).join("\n") + `\n... (truncated, ${lines.length} total lines)`
          : content;
        results.push({ path: filePath, content: truncated, lines: lines.length });
      } catch {
        // File not found or unreadable — skip
      }
    }

    return results;
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
