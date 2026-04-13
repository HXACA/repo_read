import type { LanguageModel, ToolSet } from "ai";
import { runAgentLoop } from "../agent/agent-loop.js";
import type { StepInfo } from "../agent/agent-loop.js";
import type { MainAuthorContext } from "../types/agent.js";
import type { CitationRecord } from "../types/generation.js";
import { buildPageDraftSystemPrompt, buildPageDraftUserPrompt } from "./page-drafter-prompt.js";
import type { PageDraftPromptInput } from "./page-drafter-prompt.js";
import { createCatalogTools } from "../catalog/catalog-tools.js";


export type PageDraftResult = {
  success: boolean;
  markdown?: string;
  metadata?: {
    summary: string;
    citations: CitationRecord[];
    related_pages: string[];
  };
  error?: string;
  /**
   * True if the LLM stopped because it hit the output token ceiling
   * (finishReason === "length"). The pipeline uses this to force a
   * "shorten the page" retry cycle before the reviewer runs.
   */
  truncated?: boolean;
};

export type PageDrafterOptions = {
  model: LanguageModel;
  repoRoot: string;
  /** Upper bound on tool-call steps within a single draft run. Defaults to 20. */
  maxSteps?: number;
  /**
   * Upper bound on output tokens for the final assistant message. Defaults
   * to 16384, which gives roughly 2× headroom over Claude's default 8192
   * and comfortably fits a full-length page + mermaid + JSON metadata.
   * If the model still hits this limit the draft is marked `truncated`
   * and the pipeline triggers a "shorten it" revise loop.
   */
  maxOutputTokens?: number;
  onStep?: (step: StepInfo) => void;
};

/**
 * Strip LLM "chain-of-thought" artifacts that sometimes wrap the real
 * page content:
 *
 *   1. A preamble line like "Now I have all the necessary information.
 *      Let me write the page." that the model produces before switching
 *      into output mode.
 *   2. An outer ```markdown … ``` fence that Claude often wraps the entire
 *      answer in when it has been given a revision instruction.
 *
 * The trailing ```json metadata block is preserved so `parseOutput` can
 * still pull citations/summary out of it.
 *
 * Exported for unit testing.
 */
export function stripDraftOutputWrappers(raw: string): string {
  let text = raw;

  // Step 1 — drop any leading text that appears before the FIRST of either
  // (a) a line beginning with "# " (a real heading) or
  // (b) a ```markdown fence opener.
  //
  // Whichever comes first is treated as "where the real content begins".
  const headingIdx = text.search(/^#\s/m);
  const fenceIdx = text.indexOf("```markdown");
  const candidates = [headingIdx, fenceIdx].filter((i) => i >= 0);
  const startIdx = candidates.length > 0 ? Math.min(...candidates) : -1;
  if (startIdx > 0) {
    text = text.slice(startIdx);
  }

  // Step 2 — if the content now starts with an outer ```markdown fence,
  // strip the opener and the matching closer. The closer is the ``` that
  // appears immediately before the trailing ```json metadata block (if
  // present) or at the very end of the text otherwise.
  if (text.startsWith("```markdown")) {
    text = text.replace(/^```markdown[^\n]*\n/, "");
    // Case A: closing ``` sits between the markdown body and the ```json block
    text = text.replace(/\n```(\s*\n+```json)/, "$1");
    // Case B: no ```json block — strip the final ``` at EOF
    if (!/```json\s*\n[\s\S]*?\n```\s*$/.test(text)) {
      text = text.replace(/\n```\s*$/, "\n");
    }
  }

  return text.trim();
}

export class PageDrafter {
  private readonly model: LanguageModel;
  private readonly repoRoot: string;
  private readonly maxSteps: number;
  private readonly maxOutputTokens?: number;
  private readonly onStep?: (step: StepInfo) => void;

  constructor(options: PageDrafterOptions) {
    this.model = options.model;
    this.repoRoot = options.repoRoot;
    this.maxSteps = options.maxSteps ?? 20;
    this.maxOutputTokens = options.maxOutputTokens;
    this.onStep = options.onStep;
  }

  async draft(
    context: MainAuthorContext,
    input: PageDraftPromptInput,
  ): Promise<PageDraftResult> {
    const systemPrompt = buildPageDraftSystemPrompt();
    const userPrompt = buildPageDraftUserPrompt(context, input);
    const tools = createCatalogTools(this.repoRoot);

    try {
      const result = await runAgentLoop({
        model: this.model,
        system: systemPrompt,
        tools: tools as unknown as ToolSet,
        maxSteps: this.maxSteps,
        maxOutputTokens: this.maxOutputTokens,
        onStep: this.onStep,
      }, userPrompt);

      const parsed = this.parseOutput(result.text);
      // Surface truncation so the pipeline can force a "shorten it" retry
      // before calling the reviewer on half-written content.
      const finishReason = result.steps[result.steps.length - 1]?.finishReason;
      if (finishReason === "length") {
        parsed.truncated = true;
      }
      return parsed;
    } catch (err) {
      return { success: false, error: `Page drafting failed: ${(err as Error).message}` };
    }
  }

  private parseOutput(text: string): PageDraftResult {
    // Strip LLM preamble + outer ```markdown fence
    const cleaned = stripDraftOutputWrappers(text);

    // If the model DID produce a trailing ```json block, strip it from the
    // markdown (we'll extract metadata deterministically anyway).
    const jsonMatch = cleaned.match(/```json\s*\n[\s\S]*?\n```\s*$/);
    const markdown = jsonMatch
      ? cleaned.slice(0, jsonMatch.index).trim()
      : cleaned.trim();

    // === Deterministic metadata extraction ===
    // Instead of relying on the model to produce a JSON metadata block
    // (which MiniMax and GLM both frequently omit), we derive all three
    // metadata fields directly from the markdown content.
    const metadata = extractMetadataFromMarkdown(markdown);

    return { success: true, markdown, metadata };
  }
}

/**
 * Extract summary, citations, and related_pages deterministically from
 * the page markdown. This is more reliable than asking the model to
 * duplicate this information in a trailing JSON block.
 *
 * Exported for unit testing.
 */
export function extractMetadataFromMarkdown(markdown: string): {
  summary: string;
  citations: CitationRecord[];
  related_pages: string[];
} {
  // --- Summary: first non-heading, non-empty paragraph after the # title ---
  const lines = markdown.split("\n");
  let summary = "";
  let pastTitle = false;
  let inCodeFence = false;
  for (const line of lines) {
    // Track code fence state to skip content inside fenced blocks
    if (line.trimStart().startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    if (!pastTitle) {
      if (line.startsWith("# ")) pastTitle = true;
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip headings, lists, tables
    if (/^(#{1,6}\s|[-*]\s|\|)/.test(trimmed)) continue;
    summary = trimmed;
    break;
  }
  if (!summary) summary = markdown.slice(0, 200);

  // --- Citations: scan all [cite:kind:target:locator] markers ---
  const citationRegex = /\[cite:(\w+):([^\]:\s]+?)(?::([^\]]+?))?\]/g;
  const seen = new Set<string>();
  const citations: CitationRecord[] = [];
  let m: RegExpExecArray | null;
  while ((m = citationRegex.exec(markdown)) !== null) {
    const kind = m[1] as CitationRecord["kind"];
    const target = m[2];
    const locator = m[3] || undefined;
    const key = `${kind}:${target}:${locator ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({ kind, target, locator });
  }

  // --- Related pages: extract slugs from [cite:page:slug] markers ---
  const relatedSet = new Set<string>();
  for (const c of citations) {
    if (c.kind === "page") relatedSet.add(c.target);
  }
  const related_pages = [...relatedSet];

  return { summary, citations, related_pages };
}
