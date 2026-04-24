import type { LanguageModel, ToolSet } from "ai";
import type { StepInfo } from "../agent/agent-loop.js";
import type { MainAuthorContext } from "../types/agent.js";
import type { CitationRecord } from "../types/generation.js";
import type { UsageInput } from "../utils/usage-tracker.js";
import { buildPageDraftSystemPrompt, buildPageDraftUserPrompt } from "./page-drafter-prompt.js";
import type { PageDraftPromptInput } from "./page-drafter-prompt.js";
import { createCatalogTools } from "../catalog/catalog-tools.js";
import { PromptAssembler } from "../prompt/assembler.js";
import { TurnEngineAdapter } from "../runtime/turn-engine.js";
import type { ProviderCallOptions } from "../runtime/turn-types.js";


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
  metrics?: { llmCalls: number; usage: UsageInput };
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
  allowBash?: boolean;
  providerCallOptions?: ProviderCallOptions;
  onStep?: (step: StepInfo) => void;
};

/**
 * Compute the tool-calling step budget for a draft attempt.
 *
 * Initial drafts (attempt 0) get the full budget. Revisions shrink because the
 * drafter already has the previous draft and targeted reviewer feedback — it
 * should be fixing specific issues, not re-exploring the repository from
 * scratch. Empirical run data showed revision attempts averaging 8 rounds
 * with outliers to 25+, and the 73% of drafter calls that are revisions
 * dominate overall token cost.
 *
 * Scaling: 100% / 60% / 40% / 40%+ (floored at 4 steps so small presets
 * like `budget` still complete).
 */
export function revisionStepBudget(baseMaxSteps: number, attempt: number): number {
  if (attempt <= 0) return baseMaxSteps;
  const factor = attempt === 1 ? 0.6 : 0.4;
  return Math.max(4, Math.floor(baseMaxSteps * factor));
}

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
/**
 * Detect LLM-thinking-stream contamination in a drafted page.
 *
 * Reference case: CubeSandbox 2026-04-22 page 7 (Cubelet). After two failures
 * to the MiniMax empty-output bug, the third attempt returned ~20k tokens
 * that weren't the actual page content — they were the model's internal
 * planning stream ("OK, let me think...", "Actually, I realize...", "Let me
 * write now. For real this time."). `stripDraftOutputWrappers` left it
 * alone (structurally valid: it started with a `#` heading). The reviewer
 * accepted it because citation format and section count matched. It
 * published as a broken page.
 *
 * Heuristic: count how many paragraphs start with "thinking-out-loud"
 * meta phrases. Paragraphs here means newline-separated chunks. One or
 * two such phrases ("Let's look at..." in a legitimate page intro) is
 * fine; a run of 5+ or a ratio above 40% means the model handed us its
 * scratchpad.
 *
 * Returns null when the page looks clean, or diagnostic fields when it
 * looks contaminated. The pipeline treats a non-null result as a draft
 * failure and triggers a fresh revision.
 */
export function detectMetaCommentary(
  body: string,
): { matchedPhrases: number; matchedRatio: number; totalParagraphs: number } | null {
  // Regex anchored to start-of-paragraph. Each entry is a distinct
  // meta-commentary opener I've seen leak from reasoning models — mostly
  // English since LLMs tend to think in English even when asked for zh.
  const META_OPENERS = [
    /^Let me (think|write|also|check|verify|plan|read|look|trace|re-?read|walk|make)/i,
    /^Let's (think|write|also|start|look|plan|do)/i,
    /^OK,? (I|let|writing|that|so|for|now)/i,
    /^Okay,? (I|let|writing|that|so|for|now)/i,
    /^Actually,?\s+I\b/i,
    /^I realize\b/i,
    /^I should\b/i,
    /^I need to\b/i,
    /^I'll (write|use|cite|plan|structure|include|add|mention)/i,
    /^Wait,?\s+/i,
    /^Hmm,?\s+/i,
    /^Writing now\b/i,
    /^Then the\b/i, // "Then the summary paragraph." "Then the sections."
    /^Now let me\b/i,
    /^So let me\b/i,
    /^But wait\b/i,
    /^Of course\b/i,
    /^From evidence entry\b/i, // internal scratchpad reference to retrieved context
    /^Looking at\b.+, (I|the evidence|the code)/i,
    /^Based on (the|my)\b.+,?\s+(I|let)/i,
  ];

  // Remove balanced fenced code blocks as a preprocessing step. An
  // unbalanced leading ``` (from corrupted LLM output) won't consume the
  // rest of the body — we just drop its noise marker and keep parsing
  // paragraphs. A balanced pair drops cleanly.
  const stripped = body.replace(/^```[^\n]*\n[\s\S]*?\n```\s*$/gm, "");
  // Remove any remaining lone ``` markers (unbalanced orphans).
  const noFences = stripped.replace(/^```[^\n]*$/gm, "");

  const blocks = noFences
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const proseParagraphs = blocks.filter((b) => {
    if (/^#{1,6}\s/.test(b)) return false; // heading
    if (/^[-*+]\s/.test(b)) return false; // list item
    if (/^\|/.test(b)) return false; // table row
    return true;
  });

  if (proseParagraphs.length === 0) return null;

  let matched = 0;
  for (const p of proseParagraphs) {
    const first = p.trim().split(/\n/)[0];
    if (META_OPENERS.some((re) => re.test(first))) matched += 1;
  }

  const ratio = matched / proseParagraphs.length;
  // Two conditions trigger the guard:
  //   (a) absolute count ≥ 5 (catches long contaminated pages with some
  //       real prose mixed in),
  //   (b) ratio ≥ 0.4 on a small page (catches short-but-mostly-meta pages).
  // Neither alone is sufficient — one or two casual openers in a long page
  // is fine, and a single suspicious line in a three-paragraph page is not
  // enough signal.
  if (matched >= 5 || (matched >= 3 && ratio >= 0.4)) {
    return { matchedPhrases: matched, matchedRatio: ratio, totalParagraphs: proseParagraphs.length };
  }
  return null;
}

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
    // Strip the opener; handle both "```markdown\n..." and the edge case
    // "```markdown<EOF>" (empty fence body, e.g. truncated model output).
    text = text.replace(/^```markdown[^\n]*(?:\n|$)/, "");
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
  private readonly allowBash: boolean;
  private readonly providerCallOptions?: ProviderCallOptions;
  private readonly onStep?: (step: StepInfo) => void;
  private readonly promptAssembler: PromptAssembler;
  private readonly turnEngine: TurnEngineAdapter;

  constructor(options: PageDrafterOptions) {
    this.model = options.model;
    this.repoRoot = options.repoRoot;
    this.maxSteps = options.maxSteps ?? 20;
    this.maxOutputTokens = options.maxOutputTokens;
    this.allowBash = options.allowBash ?? true;
    this.providerCallOptions = options.providerCallOptions;
    this.onStep = options.onStep;
    this.promptAssembler = new PromptAssembler();
    this.turnEngine = new TurnEngineAdapter();
  }

  async draft(
    context: MainAuthorContext,
    input: PageDraftPromptInput,
    /**
     * Optional per-call overrides. Use `maxSteps` to shrink the tool-calling
     * budget on revision attempts where the drafter already has the previous
     * draft and targeted reviewer feedback (no need to re-explore the repo).
     */
    overrides?: { maxSteps?: number },
  ): Promise<PageDraftResult> {
    const systemPrompt = buildPageDraftSystemPrompt();
    const userPrompt = buildPageDraftUserPrompt(context, input);
    const tools = createCatalogTools(this.repoRoot, { allowBash: this.allowBash });
    const effectiveMaxSteps = overrides?.maxSteps ?? this.maxSteps;

    try {
      const assembled = this.promptAssembler.assemble({ role: "drafter", language: input.language, systemPrompt, userPrompt });
      const result = await this.turnEngine.run({
        purpose: "draft",
        model: this.model,
        systemPrompt: assembled.system,
        userPrompt: assembled.user,
        tools: tools as unknown as ToolSet,
        policy: {
          maxSteps: effectiveMaxSteps,
          ...(this.maxOutputTokens ? { maxOutputTokens: this.maxOutputTokens } : {}),
          providerOptions: this.providerCallOptions,
        },
        onStep: this.onStep,
      });

      const parsed = this.parseOutput(result.text);
      // Surface truncation so the pipeline can force a "shorten it" retry
      // before calling the reviewer on half-written content.
      const finishReason = result.finishReason;
      if (finishReason === "length") {
        parsed.truncated = true;
      }
      parsed.metrics = {
        llmCalls: 1,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          reasoningTokens: result.usage.reasoningTokens,
          cachedTokens: result.usage.cachedTokens,
        },
      };
      // Guard against silent empty output. Some providers return HTTP 200 with
      // an empty body after many tool-calling rounds — parseOutput then yields
      // {success: true, markdown: ""}, which the pipeline turns into a generic
      // "Page X drafting failed" with no diagnostic. Flipping to success=false
      // here lets the error reach events/logs with actionable detail.
      //
      // Also distinguish two empty-output flavors so triage has a clearer
      // starting point:
      //   - rawTextLength=0, outputTokens=0  → provider returned nothing
      //   - rawTextLength=0, outputTokens>0  → provider generated tokens but
      //     dropped them on the serialization path (vendor-level bug). This
      //     variant is rarer but harder to diagnose without the hint.
      if (parsed.success && !parsed.markdown?.trim()) {
        const rawTextLength = (result.text ?? "").length;
        const outputTokens = result.usage?.outputTokens ?? 0;
        const tokensWithoutText = rawTextLength === 0 && outputTokens > 0;
        const flavor = tokensWithoutText
          ? "tokens produced but not captured (vendor serialization bug suspected)"
          : "no tokens produced";
        return {
          success: false,
          error: `Drafter produced empty output (${flavor}; finishReason=${finishReason ?? "unknown"}, rawTextLength=${rawTextLength}, outputTokens=${outputTokens})`,
          metrics: parsed.metrics,
          ...(parsed.truncated ? { truncated: true } : {}),
        };
      }
      // Guard against LLM-thinking-stream contamination. Reference case:
      // CubeSandbox 2026-04-22 page 7, MiniMax returned ~20k tokens of the
      // model's internal planning stream instead of the page body. The
      // output passed stripDraftOutputWrappers (it started with a real
      // heading), passed structural validation (citation format was
      // correct), passed the reviewer (verdict=pass because the citations
      // lined up), and published as a broken page. Flagging here forces
      // a fresh draft attempt via the revision loop.
      if (parsed.success && parsed.markdown) {
        const meta = detectMetaCommentary(parsed.markdown);
        if (meta) {
          return {
            success: false,
            error: `Drafter produced LLM-thinking-stream contamination (${meta.matchedPhrases} meta-commentary paragraphs out of ${meta.totalParagraphs}, ratio ${meta.matchedRatio.toFixed(2)}). The model returned its planning scratchpad instead of the page body.`,
            metrics: parsed.metrics,
            ...(parsed.truncated ? { truncated: true } : {}),
          };
        }
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
