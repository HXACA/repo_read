import type { MainAuthorContext } from "../types/agent.js";

export type PageDraftPromptInput = {
  slug: string;
  title: string;
  order: number;
  coveredFiles: string[];
  language: string;
};

const LANGUAGE_NAMES: Record<string, string> = {
  zh: "Chinese (简体中文)",
  en: "English",
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
  fr: "French (Français)",
  de: "German (Deutsch)",
  es: "Spanish (Español)",
};

function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

const KIND_WRITING_RULES: Record<string, string> = {
  guide: [
    "## Page Kind: Guide",
    "- Lead with what this page helps a newcomer understand",
    "- Provide a cognitive map before diving into details",
    "- Minimize code examples — focus on orientation and context",
    "- Acceptable to be overview / quickstart / onboarding style",
  ].join("\n"),
  explanation: [
    "## Page Kind: Explanation",
    "- Focus on mechanisms, design trade-offs, key interactions",
    "- This is the main reading flow — explain the \"why\" behind the \"what\"",
    "- Code examples should illustrate key patterns, not dump entire files",
  ].join("\n"),
  reference: [
    "## Page Kind: Reference",
    "- High-density structured information",
    "- Prefer tables, parameter lists, configuration keys",
    "- Minimal narrative preamble — readers are looking things up, not reading sequentially",
  ].join("\n"),
  appendix: [
    "## Page Kind: Appendix",
    "- Long-tail content: regression matrices, edge cases, compatibility notes",
    "- Explicitly note this is supplementary — don't duplicate main-flow explanations",
    "- OK to be less polished, more exhaustive",
  ].join("\n"),
};

function getKindWritingRules(pageKind?: string): string {
  if (pageKind && KIND_WRITING_RULES[pageKind]) {
    return KIND_WRITING_RULES[pageKind];
  }
  // Fall back to explanation behavior when kind is missing or unknown
  return KIND_WRITING_RULES["explanation"];
}

export function buildPageDraftSystemPrompt(): string {
  return `You are "drafter", the primary technical writer for a code-reading wiki.

Your task is to write a single wiki page as high-quality Markdown. You have access to retrieval tools (Read, Grep, Find, Git) to inspect the repository.

## Writing Voice

Write as if you are explaining the codebase to a smart colleague who just joined the team. Start each page — and each major section — from the reader's perspective: **why does this matter, then what it is, then how it works.** Never open with dry definitions; open with context and motivation. Keep prose conversational but precise.

## Do NOT
- Use "Let's dive in/explore/take a look" openings
- Add summary paragraphs at the end of sections ("In this section, we learned...")
- Convert every paragraph into bullet lists
- Use hedging phrases like "It's worth noting that" or "Interestingly"
- Start multiple consecutive sections with the same sentence structure

## Rules

1. **LANGUAGE IS STRICT**: Write ALL prose, headings, summaries, and explanations in the exact language specified in the page assignment. Code snippets, file paths, API names, and citation markers remain untranslated. If the language is Chinese, write ALL narrative text in Chinese — never fall back to English.
2. Every factual claim must be backed by evidence from the repository. Include inline citations in the format: \`[cite:kind:target:locator]\` where kind is file/page/commit. Example: \`[cite:file:src/engine.ts:42-60]\`. Keep locator ranges specific (≤ 30 lines, not entire files).
3. Structure the page with a title (\`#\` heading), a brief summary paragraph, then detailed \`##\` sections.
4. Use code blocks with language tags for code snippets.
5. **Visual elements** — use diagrams and tables actively to aid comprehension:
   - **Overview / beginner pages**: Architecture overview Mermaid diagram, feature comparison tables, visual project structure.
   - **How-to / intermediate pages**: Step-by-step Mermaid flowcharts, parameter/config tables, before/after code comparison.
   - **Deep-dive / advanced pages**: Concept relationship Mermaid diagrams, pros/cons analysis tables, class/module interaction diagrams.
   - Prefer diagrams and tables over long prose when presenting structured information.
6. Do not duplicate content from previously published pages — reference them with \`[cite:page:slug]\`.
7. Stay within the scope of the current page plan. Do not cover topics assigned to other pages.
8. **Output format**: Start DIRECTLY with the \`#\` title heading. Do NOT wrap output in \`\`\`markdown fences. Do NOT write any preamble. The very first character of your output must be \`#\`. Do NOT append a JSON metadata block at the end — metadata is extracted automatically from your citations.`;
}

export function buildPageDraftUserPrompt(
  context: MainAuthorContext,
  input: PageDraftPromptInput,
): string {
  const sections: string[] = [];

  sections.push(`## Project Summary\n${context.project_summary}`);
  sections.push(`## Full Book Summary\n${context.full_book_summary}`);

  if (context.current_page_plan) {
    sections.push(`## Current Page Plan\n${context.current_page_plan}`);
  }

  sections.push(
    `## Page Assignment`,
    `- **Title:** ${input.title}`,
    `- **Slug:** ${input.slug}`,
    `- **Order:** Page ${input.order} in the reading order`,
    `- **Output Language:** ${languageName(input.language)} — WRITE ALL NARRATIVE TEXT IN THIS LANGUAGE`,
    `- **Covered Files:** ${input.coveredFiles.join(", ")}`,
  );

  // Kind-aware writing rules
  sections.push(getKindWritingRules(context.page_kind));

  // Reader goal
  if (context.reader_goal) {
    sections.push(`## Reader Goal\nThe reader should be able to: ${context.reader_goal}`);
  }

  // Navigation context (previous/next pages)
  if (context.previous_page_slug || context.next_page_slug) {
    const parts: string[] = [];
    if (context.previous_page_slug) {
      parts.push(`follows '${context.previous_page_slug}'`);
    }
    if (context.next_page_slug) {
      parts.push(`precedes '${context.next_page_slug}'`);
    }
    sections.push(`## Page Navigation Context\nThis page ${parts.join(" and ")} in the reading order.`);
  }

  if (context.published_index_file) {
    sections.push(
      `## Previously Published Pages`,
      `The index of previously published pages is at: \`${context.published_index_file}\``,
      `Use the \`read\` tool to check what other pages have already covered — avoid duplicating their content. Reference related pages with \`[cite:page:slug]\`.`,
    );
  } else if (context.published_page_summaries.length > 0) {
    sections.push(`## Previously Published Pages`);
    for (const page of context.published_page_summaries) {
      sections.push(`- **${page.title}** (${page.slug}): ${page.summary}`);
    }
  }

  // === Evidence + Outline ===
  // When file paths are available, point the drafter to files (pointer mode).
  // Only fall back to in-context content when file paths are absent (backward compat).
  if (context.evidence_file) {
    sections.push(
      `## Evidence`,
      `The collected evidence (ledger + findings + open questions) is at: \`${context.evidence_file}\``,
      `Use the \`read\` tool to load it. Prefer these citations over running fresh retrieval — only call tools if you need to verify a claim or fill a gap.`,
    );
  } else if (context.evidence_ledger.length > 0 || context.evidence_bundle) {
    // Fallback: in-context evidence (no file path available)
    sections.push(`## Pre-collected Evidence (from workers)`);
    sections.push(
      `The following evidence was gathered in parallel before this drafting step. **Prefer these citations over running fresh retrieval** — only call tools if you need to verify a claim or fill an open question below.`,
    );
    if (context.evidence_bundle && context.evidence_bundle.findings.length > 0) {
      sections.push(`### Findings`);
      for (const f of context.evidence_bundle.findings.slice(0, 40)) {
        sections.push(`- ${f}`);
      }
    }
    if (context.evidence_ledger.length > 0) {
      sections.push(`### Evidence Ledger (cite these first)`);
      for (const entry of context.evidence_ledger) {
        const locatorPart = entry.locator ? `:${entry.locator}` : "";
        const suffix = entry.note ? ` — ${entry.note}` : "";
        sections.push(`- [${entry.kind}] ${entry.target}${locatorPart}${suffix}`);
      }
    }
    if (context.evidence_bundle && context.evidence_bundle.open_questions.length > 0) {
      sections.push(`### Open Questions (verify with tools if needed)`);
      for (const q of context.evidence_bundle.open_questions.slice(0, 20)) {
        sections.push(`- ${q}`);
      }
    }
  }

  if (context.outline_file) {
    sections.push(
      `## Page Outline`,
      `The page outline is at: \`${context.outline_file}\``,
      `Use the \`read\` tool to load the outline structure, then write the page following that structure.`,
    );
  } else if (context.page_outline && context.page_outline.sections.length > 0) {
    // Fallback: in-context outline (no file path available)
    sections.push(
      `## Page Outline (follow this structure)`,
      `Write the page following the sections below. Each section lists its key points and the evidence entries you MUST cite. Use \`[cite:file:target:locator]\` for each cite_from entry.`,
    );
    for (const sec of context.page_outline.sections) {
      const citeList = sec.cite_from
        .map((c) => `${c.target}${c.locator ? `:${c.locator}` : ""}`)
        .join(", ");
      sections.push(
        `### § ${sec.heading}`,
        `- Key points: ${sec.key_points.join("; ")}`,
        `- Cite from: ${citeList || "(use retrieval tools)"}`,
      );
    }
  }

  // === Mechanisms to cover ===
  if (context.mechanisms && context.mechanisms.length > 0) {
    const mechBlock = context.mechanisms
      .map((m) => `- [${m.id}] ${m.description} (requirement: ${m.coverageRequirement})`)
      .join("\n");
    const outOfScopeSection = (context.mechanisms_out_of_scope ?? []).length > 0
      ? `\n\nOut of scope for this page (do NOT expand):\n${context.mechanisms_out_of_scope!.map((id) => `- ${id}`).join("\n")}`
      : "";
    sections.push(
      `## MECHANISMS TO COVER\n${mechBlock}${outOfScopeSection}\n\nFor each mechanism:\n- must_cite: include a \`[cite:...]\` marker referencing its citation target in the relevant section.\n- must_mention: include the target name or description keywords somewhere in the body.`,
    );
  }

  // === Revision context — included when re-drafting after a "revise" verdict ===
  if (context.revision) {
    const r = context.revision;
    sections.push(
      `## REVISION REQUEST (Attempt ${r.attempt + 1})`,
      `Your previous draft was reviewed and the reviewer asked for changes. **You must address every blocker below**, then re-output the complete page from scratch.`,
    );

    const fb = r.feedback;
    if (fb.blockers.length > 0) {
      sections.push("### Blockers (MUST fix)");
      fb.blockers.forEach((b, i) => sections.push(`${i + 1}. ${b}`));
    }
    if (fb.factual_risks.length > 0) {
      sections.push("### Factual risks (verify and correct)");
      fb.factual_risks.forEach((b, i) => sections.push(`${i + 1}. ${b}`));
    }
    if (fb.missing_evidence.length > 0) {
      sections.push("### Missing evidence (read these files and cite them)");
      fb.missing_evidence.forEach((b, i) => sections.push(`${i + 1}. ${b}`));
    }
    if (fb.scope_violations.length > 0) {
      sections.push("### Scope violations (remove or move out)");
      fb.scope_violations.forEach((b, i) => sections.push(`${i + 1}. ${b}`));
    }
    if (fb.missing_coverage && fb.missing_coverage.length > 0) {
      sections.push(
        `### Missing mechanism coverage (MUST address in this revision)\n${fb.missing_coverage.map((id) => `- ${id}`).join("\n")}\n\nFor each id above, locate its entry in the MECHANISMS TO COVER block and add the required [cite:...] or mention.`,
      );
    }
    if (fb.suggested_revisions.length > 0) {
      sections.push("### Suggested revisions");
      fb.suggested_revisions.forEach((b, i) => sections.push(`${i + 1}. ${b}`));
    }

    if (context.draft_file) {
      sections.push(
        `### Previous draft`,
        `Your previous draft is at: \`${context.draft_file}\``,
        `Use the \`read\` tool to review it, then fix the specific issues listed above.`,
      );
    } else {
      sections.push(
        "### Previous draft (for reference)",
        "```markdown",
        r.previous_draft.slice(0, 4000) +
          (r.previous_draft.length > 4000 ? "\n...[truncated]" : ""),
        "```",
      );
    }
  }

  const hasPreEvidence =
    !!context.evidence_file || context.evidence_ledger.length > 0 || !!context.evidence_bundle;

  sections.push(
    `## Instructions`,
    context.revision
      ? `**Re-write** the complete wiki page for "${input.title}" addressing every blocker and reviewer note above. Use the retrieval tools to verify facts and read additional files mentioned in "missing evidence". Output the FULL page (not a diff).\n\n**CRITICAL**: Start your output with \`# ${input.title}\` — no preamble text, no \`\`\`markdown wrapper. Your very first character must be \`#\`.`
      : hasPreEvidence
        ? `Write the complete wiki page for "${input.title}". Evidence was already collected by workers — ${context.evidence_file ? "read the evidence file listed above" : "use the Pre-collected Evidence section above"} as your primary source of truth. Only call retrieval tools to verify specific claims, resolve open questions, or read a file not yet covered.`
        : `Write the complete wiki page for "${input.title}". Use the retrieval tools to read the covered files and gather evidence. Then produce the page as Markdown with inline citations.`,
  );

  return sections.join("\n\n");
}
