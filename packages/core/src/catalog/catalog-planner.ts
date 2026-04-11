import { stepCountIs } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import { generateViaStream as generateText } from "../utils/generate-via-stream.js";
import type { RepoProfile } from "../types/project.js";
import type { WikiJson } from "../types/generation.js";
import { buildCatalogSystemPrompt, buildCatalogUserPrompt } from "./catalog-prompt.js";
import { createCatalogTools } from "./catalog-tools.js";
import { extractJson } from "../utils/extract-json.js";

export type CatalogPlannerOptions = {
  model: LanguageModel;
  language: string;
  maxSteps?: number;
  maxRetries?: number;
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
  private readonly maxRetries: number;

  constructor(options: CatalogPlannerOptions) {
    this.model = options.model;
    this.language = options.language;
    this.maxSteps = options.maxSteps ?? 20;
    this.maxRetries = options.maxRetries ?? 3;
  }

  async plan(profile: RepoProfile): Promise<CatalogPlanResult> {
    const systemPrompt = buildCatalogSystemPrompt();
    const tools = createCatalogTools(profile.repoRoot);

    let lastError = "";
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        // On retry, append the previous error so the model knows what went wrong
        let userPrompt = buildCatalogUserPrompt(profile, this.language);
        if (attempt > 0 && lastError) {
          userPrompt += `\n\n## Previous Attempt Failed (attempt ${attempt}/${this.maxRetries})\n\nError: ${lastError}\n\nPlease fix the issue and output a valid JSON object with "summary" and "reading_order" fields. Output ONLY the JSON object.`;
        }

        const result = await generateText({
          model: this.model,
          system: systemPrompt,
          prompt: userPrompt,
          tools: tools as unknown as ToolSet,
          stopWhen: stepCountIs(this.maxSteps),
        });

        const wiki = this.parseWikiJson(result.text);

        return {
          success: true,
          wiki,
          usage: result.usage ? {
            promptTokens: (result.usage as { inputTokens?: number }).inputTokens ?? 0,
            completionTokens: (result.usage as { outputTokens?: number }).outputTokens ?? 0,
            totalTokens: ((result.usage as { inputTokens?: number }).inputTokens ?? 0) + ((result.usage as { outputTokens?: number }).outputTokens ?? 0),
          } : undefined,
        };
      } catch (err) {
        lastError = (err as Error).message;
      }
    }
    return { success: false, error: `Catalog planning failed after ${this.maxRetries} attempts: ${lastError}` };
  }

  private parseWikiJson(text: string): WikiJson {
    const parsed = extractJson(text);
    if (!parsed || !parsed.summary || !Array.isArray(parsed.reading_order)) {
      throw new Error(`Invalid wiki.json structure: missing summary or reading_order. Model output was ${text.length} chars: "${text.slice(0, 200)}"`);
    }
    return parsed as unknown as WikiJson;
  }
}
