import { generateText } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import type { RepoProfile } from "../types/project.js";
import type { WikiJson } from "../types/generation.js";
import { buildCatalogSystemPrompt, buildCatalogUserPrompt } from "./catalog-prompt.js";
import { createCatalogTools } from "./catalog-tools.js";

export type CatalogPlannerOptions = {
  model: LanguageModel;
  language: string;
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

  constructor(options: CatalogPlannerOptions) {
    this.model = options.model;
    this.language = options.language;
  }

  async plan(profile: RepoProfile): Promise<CatalogPlanResult> {
    const systemPrompt = buildCatalogSystemPrompt();
    const userPrompt = buildCatalogUserPrompt(profile, this.language);
    const tools = createCatalogTools(profile.repoRoot);

    try {
      // Type assertion needed: AI SDK v6 Tool types use `inputSchema`
      // while our tools use `parameters` via jsonSchema(). At runtime
      // generateText accepts both forms.
      const result = await generateText({
        model: this.model,
        system: systemPrompt,
        prompt: userPrompt,
        tools: tools as unknown as ToolSet,
      });

      const wiki = this.parseWikiJson(result.text);

      return {
        success: true,
        wiki,
        usage: result.usage ? {
          promptTokens: result.usage.inputTokens ?? 0,
          completionTokens: result.usage.outputTokens ?? 0,
          totalTokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
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
