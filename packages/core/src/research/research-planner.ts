import type { LanguageModel, ToolSet } from "ai";
import { createCatalogTools } from "../catalog/catalog-tools.js";
import { PromptAssembler } from "../prompt/assembler.js";
import { TurnEngineAdapter } from "../runtime/turn-engine.js";
import type { ProviderCallOptions } from "../runtime/turn-types.js";

export type ResearchPlan = {
  topic: string;
  subQuestions: string[];
  scope: string;
};

export type ResearchPlannerOptions = {
  model: LanguageModel;
  repoRoot: string;
  maxSteps?: number;
  allowBash?: boolean;
  providerCallOptions?: ProviderCallOptions;
};

export class ResearchPlanner {
  private readonly maxSteps: number;
  private readonly promptAssembler = new PromptAssembler();
  private readonly turnEngine = new TurnEngineAdapter();

  constructor(private readonly options: ResearchPlannerOptions) {
    this.maxSteps = options.maxSteps ?? 6;
  }

  async plan(topic: string, context?: string): Promise<ResearchPlan> {
    const tools = createCatalogTools(this.options.repoRoot, { allowBash: this.options.allowBash });

    const systemPrompt = `You are a research planner for a code wiki. Break down a broad question into 2-5 focused sub-questions that can be investigated independently.

Return a JSON object:
{
  "topic": "the original topic",
  "subQuestions": ["sub-question 1", "sub-question 2", ...],
  "scope": "brief description of what this research covers"
}`;
    const userPrompt = `Research topic: ${topic}${context ? `\n\nContext: ${context}` : ""}

Use the tools to understand the codebase, then break this into focused sub-questions. Return JSON.`;
    const assembled = this.promptAssembler.assemble({ role: "research", language: "en", systemPrompt, userPrompt });

    const result = await this.turnEngine.run({
      purpose: "research-plan",
      model: this.options.model,
      systemPrompt: assembled.system,
      userPrompt: assembled.user,
      tools: tools as unknown as ToolSet,
      policy: {
        maxSteps: this.maxSteps,
        providerOptions: this.options.providerCallOptions,
      },
    });

    return this.parsePlan(result.text, topic);
  }

  private parsePlan(text: string, topic: string): ResearchPlan {
    let jsonStr = text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    try {
      const parsed = JSON.parse(jsonStr);
      return {
        topic: parsed.topic ?? topic,
        subQuestions: Array.isArray(parsed.subQuestions) ? parsed.subQuestions : [topic],
        scope: parsed.scope ?? "",
      };
    } catch {
      return { topic, subQuestions: [topic], scope: "" };
    }
  }
}
