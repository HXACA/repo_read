import type { LanguageModel, ToolSet } from "ai";
import type { PageOutline, PageOutlineSection } from "../types/agent.js";
import type { UsageInput } from "../utils/usage-tracker.js";
import { extractJson } from "../utils/extract-json.js";
import type { ProviderCallOptions } from "../runtime/turn-types.js";
import { PromptAssembler } from "../prompt/assembler.js";
import { TurnEngineAdapter } from "../runtime/turn-engine.js";
import type { Mechanism } from "./mechanism-list.js";

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
    locator?: string;
    note: string;
  }>;
  /** Natural-language findings from workers. */
  findings: string[];
  /** When non-empty, outline MUST allocate each mechanism id to either
   *  `covers_mechanisms` on some section or `out_of_scope_mechanisms`. */
  mechanisms?: Mechanism[];
};

export type OutlinePlannerOptions = {
  model: LanguageModel;
  providerCallOptions?: ProviderCallOptions;
  onStep?: (step: import("../agent/agent-loop.js").StepInfo) => void;
};

export type OutlinePlanResult = {
  outline: PageOutline;
  usedFallback: boolean;
  metrics: { llmCalls: number; usage: UsageInput };
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
    return (await this.planWithMetrics(input)).outline;
  }

  async planWithMetrics(input: OutlinePlannerInput): Promise<OutlinePlanResult> {
    const firstAttempt = await this.runLLM(input, undefined);
    const mechanisms = input.mechanisms ?? [];

    // Legacy path: no mechanism enforcement
    if (mechanisms.length === 0) return firstAttempt;

    const missingAfterFirst = deriveUnresolvedIds(firstAttempt.outline, mechanisms);
    if (missingAfterFirst.length === 0) return firstAttempt;

    // Before retry, strip out_of_scope entries that failed the ratio audit —
    // otherwise the LLM sees them in the "previous outline" snapshot and may
    // simply re-declare them as out-of-scope again.
    const prunedFirst = stripExcessOutOfScope(firstAttempt.outline, mechanisms);

    // One-shot retry asking the LLM to amend its previous outline
    const retryAttempt = await this.runLLM(input, {
      previousOutline: prunedFirst,
      missingIds: missingAfterFirst,
    });
    const combinedMetrics = {
      llmCalls: firstAttempt.metrics.llmCalls + retryAttempt.metrics.llmCalls,
      usage: sumUsage(firstAttempt.metrics.usage, retryAttempt.metrics.usage),
    };

    const missingAfterRetry = deriveUnresolvedIds(retryAttempt.outline, mechanisms);
    if (missingAfterRetry.length === 0) {
      return { ...retryAttempt, metrics: combinedMetrics };
    }

    // Deterministic fallback: force-allocate the still-missing ids to the
    // last section's covers_mechanisms. usedFallback signals to callers.
    return {
      outline: forceAllocateMechanisms(retryAttempt.outline, missingAfterRetry),
      usedFallback: true,
      metrics: combinedMetrics,
    };
  }

  private async runLLM(
    input: OutlinePlannerInput,
    retry: { previousOutline: PageOutline; missingIds: string[] } | undefined,
  ): Promise<OutlinePlanResult> {
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
      "cite_from": [{ "target": "path/to/file", "locator": "10-30" }],
      "covers_mechanisms": ["file:src/foo.ts"]
    }
  ],
  "out_of_scope_mechanisms": [{ "id": "file:src/bar.ts", "reason": "covered in another-slug" }]
}`;

    let userPrompt = this.buildUserPrompt(input);
    if (retry) {
      userPrompt += `

===== RETRY =====
Your previous outline below is MISSING the following mechanism ids: ${retry.missingIds.join(", ")}.
Update the outline to add each missing id — either to an existing section's covers_mechanisms, or to out_of_scope_mechanisms with a reason (>= 10 chars). Keep the rest of the outline stable.

Previous outline:
${JSON.stringify(retry.previousOutline, null, 2)}
`;
    }
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
          providerOptions: this.providerCallOptions,
        },
        onStep: this.onStep,
      });

      const parsed = extractJson(result.text);
      if (parsed && Array.isArray(parsed.sections)) {
        const validMechanismIds = input.mechanisms && input.mechanisms.length > 0
          ? new Set(input.mechanisms.map((m) => m.id))
          : undefined;
        const outline = this.parseOutline(parsed, validMechanismIds);
        // When mechanism enforcement is active, a 1-section outline is
        // acceptable as long as it (or out_of_scope_mechanisms) covers
        // the mechanisms. The legacy path still requires >= 2.
        const minSections = (input.mechanisms && input.mechanisms.length > 0) ? 1 : 2;
        if (outline.sections.length >= minSections) {
          return {
            outline,
            usedFallback: false,
            metrics: {
              llmCalls: 1,
              usage: {
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
                reasoningTokens: result.usage.reasoningTokens,
                cachedTokens: result.usage.cachedTokens,
              },
            },
          };
        }
      }
    } catch {
      // fall through to fallback
    }

    return {
      outline: this.fallbackOutline(input),
      usedFallback: true,
      metrics: {
        llmCalls: 0,
        usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 },
      },
    };
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
        const locatorPart = e.locator ? `:${e.locator}` : "";
        parts.push(`- [${e.kind}] ${e.target}${locatorPart}: ${e.note}`);
      }
    }

    if (input.mechanisms && input.mechanisms.length > 0) {
      parts.push("");
      parts.push("===== MECHANISMS =====");
      for (const m of input.mechanisms) {
        parts.push(`- [${m.id}] ${m.description} (requirement: ${m.coverageRequirement})`);
      }
      parts.push("");
      parts.push('For every mechanism above, your outline MUST do ONE of the following:');
      parts.push('A) Include its id in the "covers_mechanisms" array of some section whose "key_points" discuss it.');
      parts.push('B) Include it in "out_of_scope_mechanisms" with a reason at least 10 characters long (typical phrasing: "covered in <other-slug>" or "out of scope for this page").');
      parts.push("Never leave a mechanism unaccounted for.");
    }

    parts.push("Produce the outline JSON.");
    return parts.join("\n");
  }

  private parseOutline(
    data: Record<string, unknown>,
    validMechanismIds?: ReadonlySet<string>,
  ): PageOutline {
    const rawSections = Array.isArray(data.sections) ? (data.sections as unknown[]) : [];
    const sections: PageOutlineSection[] = [];
    for (const item of rawSections) {
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

      const covers_mechanisms = Array.isArray(r.covers_mechanisms)
        ? (r.covers_mechanisms as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : [];

      sections.push({ heading, key_points, cite_from, covers_mechanisms });
    }

    const out_of_scope_mechanisms = Array.isArray(data.out_of_scope_mechanisms)
      ? (data.out_of_scope_mechanisms as unknown[])
          .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
          .map((x) => ({
            id: typeof x.id === "string" ? x.id : "",
            reason: typeof x.reason === "string" ? x.reason : "",
          }))
          // Structural validation: id must be a non-empty string.
          .filter((x) => x.id.length > 0)
          // Semantic validation: reason must be meaningful (>= 10 chars trimmed).
          // Without this, the planner could silently drop any mechanism from the
          // coverage chain with a token reason.
          .filter((x) => x.reason.trim().length >= 10)
          // Anti-fabrication: id must come from the input mechanism set when
          // enforcement is active. Prevents the planner from inventing ids to
          // declare "out of scope".
          .filter((x) => validMechanismIds === undefined || validMechanismIds.has(x.id))
      : [];

    return { sections, out_of_scope_mechanisms };
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
      covers_mechanisms: [],
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
        covers_mechanisms: [],
      });
    }

    return { sections, out_of_scope_mechanisms: [] };
  }
}

function findUncoveredMechanismIds(outline: PageOutline, mechanisms: Mechanism[]): string[] {
  const claimed = new Set<string>();
  for (const section of outline.sections) {
    for (const id of section.covers_mechanisms ?? []) claimed.add(id);
  }
  for (const item of outline.out_of_scope_mechanisms ?? []) claimed.add(item.id);
  return mechanisms.map((m) => m.id).filter((id) => !claimed.has(id));
}

/**
 * Ceiling on what fraction of a page's mechanisms may be declared
 * out-of-scope. Without this cap the outline can trivially dodge coverage
 * enforcement by punting hard mechanisms into `out_of_scope_mechanisms`
 * with a boilerplate reason. 0.5 = at most half may be declared
 * out-of-scope; the rest MUST map to a section.
 */
export const MAX_OUT_OF_SCOPE_RATIO = 0.5;

/**
 * When the outline declares more than `MAX_OUT_OF_SCOPE_RATIO * total`
 * mechanisms as out-of-scope, treat the excess as uncovered. Retains the
 * first `floor(total * ratio)` out-of-scope entries (they are probably
 * legitimate cross-page references), demotes the rest to uncovered so the
 * existing retry + force-allocate loop pulls them back into a section.
 * This is an audit, not a hard rejection — it preserves forward progress
 * while preventing the outline from silently dropping half the coverage
 * chain.
 */
export function excessOutOfScopeIds(
  outline: PageOutline,
  mechanisms: Mechanism[],
  ratio: number = MAX_OUT_OF_SCOPE_RATIO,
): string[] {
  const total = mechanisms.length;
  if (total === 0) return [];
  const entries = outline.out_of_scope_mechanisms ?? [];
  const maxAllowed = Math.max(1, Math.floor(total * ratio));
  if (entries.length <= maxAllowed) return [];
  return entries.slice(maxAllowed).map((e) => e.id);
}

/**
 * Drop excess out_of_scope entries (those flagged by the ratio audit) so
 * the retry prompt shows the LLM a clean slate. Without this the LLM tends
 * to keep whatever it declared out-of-scope originally.
 */
function stripExcessOutOfScope(outline: PageOutline, mechanisms: Mechanism[]): PageOutline {
  const excess = new Set(excessOutOfScopeIds(outline, mechanisms));
  if (excess.size === 0) return outline;
  return {
    ...outline,
    out_of_scope_mechanisms: (outline.out_of_scope_mechanisms ?? []).filter(
      (e) => !excess.has(e.id),
    ),
  };
}

/**
 * Unified "unresolved mechanism ids" — missing from coverage PLUS excess
 * out-of-scope entries beyond the abuse threshold. Feeds both the retry
 * prompt (tells the LLM what to re-allocate) and the force-allocate fallback.
 */
function deriveUnresolvedIds(outline: PageOutline, mechanisms: Mechanism[]): string[] {
  const missing = findUncoveredMechanismIds(outline, mechanisms);
  const excess = excessOutOfScopeIds(outline, mechanisms);
  if (excess.length === 0) return missing;
  // Dedup — excess ids are claimed by out_of_scope, so they won't appear
  // in `missing`, but guard against future refactors.
  const combined = new Set<string>([...missing, ...excess]);
  return [...combined];
}

function forceAllocateMechanisms(outline: PageOutline, missingIds: string[]): PageOutline {
  const sections = outline.sections.length > 0
    ? outline.sections.map((s, i) =>
        i === outline.sections.length - 1
          ? { ...s, covers_mechanisms: [...(s.covers_mechanisms ?? []), ...missingIds] }
          : s,
      )
    : [
        {
          heading: "附录：未规划机制",
          key_points: ["以下机制在 outline 阶段未被正式分配到任何 section，由 drafter 自行判断如何展开"],
          cite_from: [],
          covers_mechanisms: [...missingIds],
        },
      ];
  return { ...outline, sections };
}

function sumUsage(a: UsageInput, b: UsageInput): UsageInput {
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    reasoningTokens: (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0),
    cachedTokens: (a.cachedTokens ?? 0) + (b.cachedTokens ?? 0),
  };
}
