import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { RepoProfile } from "../types/project.js";
import type { WikiJson } from "../types/generation.js";
import { buildCatalogSystemPrompt, buildCatalogUserPrompt } from "./catalog-prompt.js";
import { createCatalogTools } from "./catalog-tools.js";

export type CatalogPlannerOptions = {
  model: LanguageModel;
  language: string;
  maxSteps?: number;
};

export type CatalogPlanResult = {
  success: boolean;
  wiki?: WikiJson;
  error?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
};

export class CatalogPlanner {
  private readonly model: LanguageModel;
  private readonly language: string;
  private readonly maxSteps: number;

  constructor(options: CatalogPlannerOptions) {
    this.model = options.model;
    this.language = options.language;
    this.maxSteps = options.maxSteps ?? 20;
  }

  async plan(profile: RepoProfile): Promise<CatalogPlanResult> {
    const systemPrompt = buildCatalogSystemPrompt();
    const userPrompt = buildCatalogUserPrompt(profile, this.language);
    const tools = createCatalogTools(profile.repoRoot);

    try {
      const result = await generateText({
        model: this.model,
        system: systemPrompt,
        prompt: userPrompt,
        tools,
        maxSteps: this.maxSteps,
      });

      const wiki = this.parseWikiJson(result.text);

      return {
        success: true,
        wiki,
        usage: result.usage ? {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.promptTokens + result.usage.completionTokens,
        } : undefined,
      };
    } catch (err) {
      return { success: false, error: `Catalog planning failed: ${(err as Error).message}` };
    }
  }

  private parseWikiJson(text: string): WikiJson {
    let jsonStr = text.trim();
    // Strip markdown code fences if present
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const parsed = JSON.parse(jsonStr);
    if (!parsed.summary || !Array.isArray(parsed.reading_order)) {
      throw new Error("Invalid wiki.json structure: missing summary or reading_order");
    }
    return parsed as WikiJson;
  }
}
