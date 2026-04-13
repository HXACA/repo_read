import type { LanguageModel, ToolSet } from "ai";
import { runAgentLoop } from "../agent/agent-loop.js";
import type { CitationRecord } from "../types/generation.js";
import { createCatalogTools } from "../catalog/catalog-tools.js";

export type SubQuestionResult = {
  question: string;
  findings: string[];
  citations: CitationRecord[];
  openQuestions: string[];
};

export type ResearchExecutorOptions = {
  model: LanguageModel;
  repoRoot: string;
  maxSteps?: number;
  allowBash?: boolean;
};

export class ResearchExecutor {
  private readonly maxSteps: number;

  constructor(private readonly options: ResearchExecutorOptions) {
    this.maxSteps = options.maxSteps ?? 15;
  }

  async investigate(question: string): Promise<SubQuestionResult> {
    const tools = createCatalogTools(this.options.repoRoot, { allowBash: this.options.allowBash });

    const result = await runAgentLoop({
      model: this.options.model,
      system: `You are a focused code investigator. Answer the given question by examining the codebase.

Return a JSON object:
{
  "question": "the question",
  "findings": ["finding 1", "finding 2"],
  "citations": [{ "kind": "file", "target": "path", "locator": "10-20", "note": "desc" }],
  "openQuestions": ["any unresolved questions"]
}`,
      tools: tools as unknown as ToolSet,
      maxSteps: this.maxSteps,
    }, `Investigate: ${question}\n\nUse the tools to find evidence and return structured findings as JSON.`);

    return this.parseResult(result.text, question);
  }

  private parseResult(text: string, question: string): SubQuestionResult {
    let jsonStr = text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    try {
      const parsed = JSON.parse(jsonStr);
      return {
        question: parsed.question ?? question,
        findings: parsed.findings ?? [],
        citations: (parsed.citations ?? []).map((c: Record<string, string>) => ({
          kind: c.kind ?? "file",
          target: c.target,
          locator: c.locator,
          note: c.note,
        })),
        openQuestions: parsed.openQuestions ?? [],
      };
    } catch {
      return { question, findings: [text], citations: [], openQuestions: [] };
    }
  }
}
