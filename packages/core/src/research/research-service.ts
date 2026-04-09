import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { CitationRecord } from "../types/generation.js";
import type { LabeledFinding, ResearchNote } from "../types/research.js";
import { ResearchPlanner } from "./research-planner.js";
import type { ResearchPlan } from "./research-planner.js";
import { ResearchExecutor } from "./research-executor.js";
import type { SubQuestionResult } from "./research-executor.js";
import { ResearchStore } from "./research-store.js";
import { extractJson } from "../utils/extract-json.js";

export type ResearchResult = {
  note: ResearchNote;
  plan: ResearchPlan;
  subResults: SubQuestionResult[];
};

export type ResearchServiceOptions = {
  model: LanguageModel;
  storage: StorageAdapter;
  repoRoot: string;
};

/**
 * End-to-end research pipeline:
 *   1. Plan — decompose the topic into sub-questions
 *   2. Execute — investigate each sub-question in parallel (sequential for now)
 *   3. Synthesize — collapse sub-results into a three-label ResearchNote
 *      (facts / inferences / unconfirmed) via a final LLM call
 *   4. Persist — save the note via ResearchStore
 *
 * The three-label synthesis is the PRD's hard requirement (FR-023). Every
 * claim in the output lands in exactly one bucket and every fact must
 * carry at least one citation.
 */
export class ResearchService {
  private readonly planner: ResearchPlanner;
  private readonly executor: ResearchExecutor;
  private readonly store: ResearchStore;
  private readonly model: LanguageModel;

  constructor(options: ResearchServiceOptions) {
    this.planner = new ResearchPlanner({
      model: options.model,
      repoRoot: options.repoRoot,
    });
    this.executor = new ResearchExecutor({
      model: options.model,
      repoRoot: options.repoRoot,
    });
    this.store = new ResearchStore(options.storage);
    this.model = options.model;
  }

  async research(
    projectSlug: string,
    versionId: string,
    topic: string,
    context?: string,
  ): Promise<ResearchResult> {
    // 1. Plan sub-questions
    const plan = await this.planner.plan(topic, context);

    // 2. Execute each sub-question
    const subResults: SubQuestionResult[] = [];
    for (const question of plan.subQuestions) {
      const result = await this.executor.investigate(question);
      subResults.push(result);
    }

    // 3. Synthesize into three labeled buckets
    const labeled = await this.synthesize(plan, subResults);

    // 4. Build and persist the note
    const note: ResearchNote = {
      id: randomUUID(),
      projectSlug,
      versionId,
      topic,
      scope: plan.scope,
      createdAt: new Date().toISOString(),
      facts: labeled.facts,
      inferences: labeled.inferences,
      unconfirmed: labeled.unconfirmed,
      summary: labeled.summary,
    };
    await this.store.save(note);

    return { note, plan, subResults };
  }

  /**
   * Ask the LLM to collapse sub-question findings into three labeled
   * buckets. The prompt enforces strict JSON and the parser falls back to
   * a conservative "everything is unconfirmed" bucket if parsing fails.
   */
  private async synthesize(
    plan: ResearchPlan,
    subResults: SubQuestionResult[],
  ): Promise<{
    facts: LabeledFinding[];
    inferences: LabeledFinding[];
    unconfirmed: LabeledFinding[];
    summary: string;
  }> {
    const systemPrompt = `You are the synthesis step of a code-reading research pipeline.

You receive a research topic and a list of sub-question results (each with findings and citations). Your job: distill them into three labeled buckets.

Rules:
1. "facts" — claims directly supported by a citation. Every fact MUST cite at least one source.
2. "inferences" — claims derived by combining multiple facts or reasoning over them. Inferences may cite their supporting facts.
3. "unconfirmed" — open questions, conflicting evidence, or things the sub-questions could not resolve.
4. Every claim in the final output must land in EXACTLY ONE bucket. Do not repeat.
5. Write the "summary" as 1-3 paragraphs that explain the topic overall, without restating every finding.
6. Output ONLY a single JSON object. No prose before or after. No markdown fences.

Schema:

{
  "facts": [{ "statement": "...", "citations": [{ "kind": "file", "target": "...", "locator": "...", "note": "..." }] }],
  "inferences": [{ "statement": "...", "citations": [...] }],
  "unconfirmed": [{ "statement": "...", "citations": [] }],
  "summary": "overall synthesis (1-3 paragraphs)"
}`;

    const userPrompt = this.buildSynthesisPrompt(plan, subResults);

    try {
      const result = await generateText({
        model: this.model,
        system: systemPrompt,
        prompt: userPrompt,
      });

      const parsed = extractJson(result.text);
      if (parsed) {
        const facts = parseLabeledFindings(parsed.facts);
        const inferences = parseLabeledFindings(parsed.inferences);
        const unconfirmed = parseLabeledFindings(parsed.unconfirmed);
        const summary =
          typeof parsed.summary === "string" ? parsed.summary : "";
        return { facts, inferences, unconfirmed, summary };
      }
    } catch {
      // fall through to fallback
    }

    return this.fallbackSynthesis(plan, subResults);
  }

  private buildSynthesisPrompt(
    plan: ResearchPlan,
    subResults: SubQuestionResult[],
  ): string {
    const sections: string[] = [];
    sections.push(`## Topic\n${plan.topic}`);
    sections.push(`## Scope\n${plan.scope}`);

    sections.push(`## Sub-question Results`);
    for (const r of subResults) {
      sections.push(`### ${r.question}`);
      if (r.findings.length > 0) {
        sections.push("Findings:");
        r.findings.forEach((f) => sections.push(`- ${f}`));
      }
      if (r.citations.length > 0) {
        sections.push("Citations:");
        for (const c of r.citations) {
          sections.push(
            `- [${c.kind}] ${c.target}${c.locator ? `:${c.locator}` : ""}${c.note ? ` — ${c.note}` : ""}`,
          );
        }
      }
      if (r.openQuestions.length > 0) {
        sections.push("Open questions:");
        r.openQuestions.forEach((q) => sections.push(`- ${q}`));
      }
    }

    sections.push(
      `## Task\nProduce the labeled JSON described in the system prompt. Every claim must land in exactly one of facts / inferences / unconfirmed.`,
    );
    return sections.join("\n\n");
  }

  /**
   * Conservative fallback when synthesis LLM call fails: convert sub-results
   * directly into buckets by heuristic — findings with citations become
   * facts, findings without citations become inferences, open questions
   * become unconfirmed.
   */
  private fallbackSynthesis(
    plan: ResearchPlan,
    subResults: SubQuestionResult[],
  ): {
    facts: LabeledFinding[];
    inferences: LabeledFinding[];
    unconfirmed: LabeledFinding[];
    summary: string;
  } {
    const facts: LabeledFinding[] = [];
    const inferences: LabeledFinding[] = [];
    const unconfirmed: LabeledFinding[] = [];

    for (const r of subResults) {
      const cited = r.citations.length > 0;
      for (const f of r.findings) {
        if (cited) {
          facts.push({ statement: f, citations: [...r.citations] });
        } else {
          inferences.push({ statement: f, citations: [] });
        }
      }
      for (const q of r.openQuestions) {
        unconfirmed.push({ statement: q, citations: [] });
      }
    }

    return {
      facts,
      inferences,
      unconfirmed,
      summary: `Research into "${plan.topic}" produced ${facts.length} cited facts, ${inferences.length} inferences, and ${unconfirmed.length} open questions. (Note: synthesis LLM call failed; this summary was generated from raw sub-results.)`,
    };
  }
}

function parseLabeledFindings(raw: unknown): LabeledFinding[] {
  if (!Array.isArray(raw)) return [];
  const findings: LabeledFinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const statement =
      typeof r.statement === "string" ? r.statement.trim() : "";
    if (!statement) continue;
    const citations = Array.isArray(r.citations)
      ? (r.citations as unknown[])
          .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
          .map((c) => {
            const kindRaw = c.kind;
            return {
              kind:
                kindRaw === "page" || kindRaw === "commit" ? kindRaw : "file",
              target: typeof c.target === "string" ? c.target : "",
              locator: typeof c.locator === "string" ? c.locator : undefined,
              note: typeof c.note === "string" ? c.note : undefined,
            } as CitationRecord;
          })
          .filter((c) => c.target !== "")
      : [];
    findings.push({ statement, citations });
  }
  return findings;
}
