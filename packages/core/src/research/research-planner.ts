import { generateText, stepCountIs } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import { createCatalogTools } from "../catalog/catalog-tools.js";

export type ResearchPlan = {
  topic: string;
  subQuestions: string[];
  scope: string;
};

export type ResearchPlannerOptions = {
  model: LanguageModel;
  repoRoot: string;
  /**
   * Upper bound on tool-call steps for the planner's single LLM call.
   * The planner is lightweight (it only needs enough calls to understand
   * the high-level structure), so this is capped well below executor.
   * Defaults to 6.
   */
  maxSteps?: number;
};

export class ResearchPlanner {
  private readonly maxSteps: number;

  constructor(private readonly options: ResearchPlannerOptions) {
    this.maxSteps = options.maxSteps ?? 6;
  }

  async plan(topic: string, context?: string): Promise<ResearchPlan> {
    const tools = createCatalogTools(this.options.repoRoot);

    const result = await generateText({
      model: this.options.model,
      system: `You are a research planner for a code wiki. Break down a broad question into 2-5 focused sub-questions that can be investigated independently.

Return a JSON object:
{
  "topic": "the original topic",
  "subQuestions": ["sub-question 1", "sub-question 2", ...],
  "scope": "brief description of what this research covers"
}`,
      prompt: `Research topic: ${topic}${context ? `\n\nContext: ${context}` : ""}

Use the tools to understand the codebase, then break this into focused sub-questions. Return JSON.`,
      tools: tools as unknown as ToolSet,
      stopWhen: stepCountIs(this.maxSteps),
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
