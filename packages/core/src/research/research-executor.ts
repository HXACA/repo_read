import type { LanguageModel, ToolSet } from "ai";
import type { CitationRecord } from "../types/generation.js";
import { createCatalogTools } from "../catalog/catalog-tools.js";
import { PromptAssembler } from "../prompt/assembler.js";
import { TurnEngineAdapter } from "../runtime/turn-engine.js";

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
  private readonly promptAssembler = new PromptAssembler();
  private readonly turnEngine = new TurnEngineAdapter();

  constructor(private readonly options: ResearchExecutorOptions) {
    this.maxSteps = options.maxSteps ?? 15;
  }

  async investigate(question: string): Promise<SubQuestionResult> {
    const tools = createCatalogTools(this.options.repoRoot, { allowBash: this.options.allowBash });

    const systemPrompt = `You are a focused code investigator. Answer the given question by examining the codebase.

Return a JSON object:
{
  "question": "the question",
  "findings": ["finding 1", "finding 2"],
  "citations": [{ "kind": "file", "target": "path", "locator": "10-20", "note": "desc" }],
  "openQuestions": ["any unresolved questions"]
}`;
    const userPrompt = `Investigate: ${question}\n\nUse the tools to find evidence and return structured findings as JSON.`;
    const assembled = this.promptAssembler.assemble({ role: "research", language: "en", systemPrompt, userPrompt });

    const result = await this.turnEngine.run({
      purpose: "research-exec",
      model: this.options.model,
      systemPrompt: assembled.system,
      userPrompt: assembled.user,
      tools: tools as unknown as ToolSet,
      policy: {
        maxSteps: this.maxSteps,
        retry: { maxRetries: 0, baseDelayMs: 0, backoffFactor: 1 },
        overflow: { strategy: "none" },
        toolBatch: { strategy: "sequential" },
      },
    });

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
