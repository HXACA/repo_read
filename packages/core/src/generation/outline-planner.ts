import type { LanguageModel, ToolSet } from "ai";
import type { PageOutline, PageOutlineSection } from "../types/agent.js";
import { extractJson } from "../utils/extract-json.js";
import type { ProviderCallOptions } from "../utils/generate-via-stream.js";
import { PromptAssembler } from "../prompt/assembler.js";
import { TurnEngineAdapter } from "../runtime/turn-engine.js";

export type OutlinePlannerInput = {
  pageTitle: string;
  pageRationale: string;
  coveredFiles: string[];
  language: string;
  /** Flat evidence ledger from EvidenceCoordinator. */
  ledger: Array<{
    id: string;
    kind: string;
    target: string;
    note: string;
  }>;
  /** Natural-language findings from workers. */
  findings: string[];
};

export type OutlinePlannerOptions = {
  model: LanguageModel;
  providerCallOptions?: ProviderCallOptions;
  onStep?: (step: import("../agent/agent-loop.js").StepInfo) => void;
};

/**
 * Produces a structured outline that maps page sections to evidence
 * entries. Sits between evidence collection and drafting so the drafter
 * receives an explicit "write this section, cite these files" brief
 * instead of a flat evidence dump.
 *
 * This is a lightweight single-turn LLM call (~500 tokens output).
 * On failure it falls back to a deterministic grouping by file path.
 */
export class OutlinePlanner {
  private readonly model: LanguageModel;
  private readonly providerCallOptions?: ProviderCallOptions;
  private readonly onStep?: (step: import("../agent/agent-loop.js").StepInfo) => void;
  private readonly promptAssembler = new PromptAssembler();
  private readonly turnEngine = new TurnEngineAdapter();

  constructor(options: OutlinePlannerOptions) {
    this.model = options.model;
    this.providerCallOptions = options.providerCallOptions;
    this.onStep = options.onStep;
  }

  async plan(input: OutlinePlannerInput): Promise<PageOutline> {
    const systemPrompt = `You are a documentation outline planner. Given a page topic, its evidence (file citations and findings), produce a structured JSON outline.

Rules:
1. Output ONLY a JSON object, no prose, no markdown fences.
2. Create 3-8 sections. Each section has a heading, 2-5 key_points, and cite_from entries drawn from the evidence ledger.
3. Every ledger entry must appear in at least one section's cite_from.
4. Headings and key_points must be in ${input.language === "zh" ? "Chinese (简体中文)" : input.language}.
5. The first section should be an overview/introduction, the last can be a summary or related topics.

Schema:
{
  "sections": [
    {
      "heading": "section heading text (no ## prefix)",
      "key_points": ["point 1", "point 2"],
      "cite_from": [{ "target": "path/to/file", "locator": "10-30" }]
    }
  ]
}`;

    const userPrompt = this.buildUserPrompt(input);
    const assembled = this.promptAssembler.assemble({ role: "outline", language: input.language, systemPrompt, userPrompt });

    try {
      const result = await this.turnEngine.run({
        purpose: "outline",
        model: this.model,
        systemPrompt: assembled.system,
        userPrompt: assembled.user,
        tools: {} as ToolSet,
        policy: {
          maxSteps: 1,
          retry: { maxRetries: 0, baseDelayMs: 0, backoffFactor: 1 },
          overflow: { strategy: "none" },
          toolBatch: { strategy: "sequential" },
          providerOptions: this.providerCallOptions,
        },
        onStep: this.onStep,
      });

      const parsed = extractJson(result.text);
      if (parsed && Array.isArray(parsed.sections)) {
        const outline = this.parseOutline(parsed.sections);
        if (outline.sections.length >= 2) {
          return outline;
        }
      }
    } catch {
      // fall through to fallback
    }

    return this.fallbackOutline(input);
  }

  private buildUserPrompt(input: OutlinePlannerInput): string {
    const parts: string[] = [];
    parts.push(`Page: ${input.pageTitle}`);
    parts.push(`Plan: ${input.pageRationale}`);
    parts.push(`Covered files: ${input.coveredFiles.join(", ")}`);

    if (input.findings.length > 0) {
      parts.push("Findings:");
      for (const f of input.findings.slice(0, 30)) {
        parts.push(`- ${f}`);
      }
    }

    if (input.ledger.length > 0) {
      parts.push("Evidence ledger:");
      for (const e of input.ledger) {
        parts.push(`- [${e.kind}] ${e.target}: ${e.note}`);
      }
    }

    parts.push("Produce the outline JSON.");
    return parts.join("\n");
  }

  private parseOutline(
    raw: unknown[],
  ): PageOutline {
    const sections: PageOutlineSection[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const heading =
        typeof r.heading === "string" ? r.heading.trim() : "";
      if (!heading) continue;

      const key_points = Array.isArray(r.key_points)
        ? (r.key_points as unknown[])
            .filter((p): p is string => typeof p === "string")
        : [];

      const cite_from = Array.isArray(r.cite_from)
        ? (r.cite_from as unknown[])
            .filter(
              (c): c is Record<string, unknown> =>
                !!c && typeof c === "object",
            )
            .map((c) => ({
              target: typeof c.target === "string" ? c.target : "",
              locator:
                typeof c.locator === "string" ? c.locator : undefined,
            }))
            .filter((c) => c.target !== "")
        : [];

      sections.push({ heading, key_points, cite_from });
    }
    return { sections };
  }

  /**
   * Deterministic fallback when the LLM call fails. Groups evidence
   * entries by file path and creates one section per group.
   */
  private fallbackOutline(input: OutlinePlannerInput): PageOutline {
    const groups = new Map<string, typeof input.ledger>();
    for (const entry of input.ledger) {
      const key = entry.target.split("/").pop() ?? entry.target;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry);
    }

    const sections: PageOutlineSection[] = [];

    // Intro section
    sections.push({
      heading: input.language === "zh" ? "概述" : "Overview",
      key_points: [input.pageRationale],
      cite_from: input.coveredFiles.slice(0, 2).map((f) => ({ target: f })),
    });

    // One section per file group
    for (const [fileName, entries] of groups) {
      sections.push({
        heading: fileName,
        key_points: entries.map((e) => e.note).filter(Boolean).slice(0, 5),
        cite_from: entries.map((e) => ({
          target: e.target,
          locator: undefined,
        })),
      });
    }

    return { sections };
  }
}
