import type { ReviewBriefing } from "../types/review.js";

export type ReviewerStrictness = "lenient" | "normal" | "strict";

/**
 * Strictness-specific phrasing for rule 6 (the verdict threshold).
 *
 * - `strict` — any factual risk counts, "when in doubt, revise"
 * - `normal` — current default: zero blockers → pass, factual risks are notes
 * - `lenient` — only hard blockers gate publication, minor issues become notes
 */
function strictnessRule(strictness: ReviewerStrictness): string {
  switch (strictness) {
    case "strict":
      return `6. Return "pass" ONLY if blockers AND factual_risks are both empty. Any unverified load-bearing claim, any citation drift beyond ±5 lines, any scope violation forces "revise". When in doubt, return "revise" — err on the side of rejection.`;
    case "lenient":
      return `6. Return "pass" unless there are HARD blockers that would actively mislead the reader (wrong API signature, nonexistent file, contradictory facts). Minor factual risks, stylistic gaps, and completeness issues should go into suggested_revisions but do NOT warrant "revise".`;
    case "normal":
    default:
      return `6. Use "pass" only if there are zero blockers. Even minor factual risks do not require "revise" if they don't block publication.`;
  }
}

export function buildReviewerSystemPrompt(
  minCitations = 0,
  strictness: ReviewerStrictness = "normal",
): string {
  const verifyBlock =
    minCitations > 0
      ? `

## Verification Requirement (MANDATORY)

You MUST call the \`read\` tool to verify at least **${minCitations}** key citations from the draft.

Selection:
- Pick the ${minCitations} most load-bearing citations — claims that would break the page if wrong (API signatures, route definitions, config keys, data structures).
- Prefer citations that support numeric values, names, or exact behaviors.

Procedure for each verified citation:
1. Call \`read\` with the cited path and line range.
2. Compare the actual file content against what the draft asserts.
3. Classify as:
   - \`match\` — cited lines contain what the draft claims. **Line drift of ±5 is OK** if the named symbol is still present at the new location.
   - \`mismatch\` — cited lines exist but contradict the draft.
   - \`not_found\` — file or line range does not exist.
4. Record the result in \`verified_citations\`.

Any \`mismatch\` or \`not_found\` MUST also be added to \`blockers\` as a specific error (e.g. "citation [cite:file:src/api.py:42-60] does not contain the claimed \`register_route\` function").

If the draft has fewer than ${minCitations} citations total, verify all of them.`
      : "";

  return `You are "fresh.reviewer", an independent quality reviewer for a code-reading wiki.

You receive a complete briefing about a page draft. You have access to retrieval tools (Read, Grep, Find, Git) to verify claims independently.

Rules:
1. You have NO prior context — the briefing is your only input.
2. You review against the page plan, not your own expectations.
3. You may re-read source files to verify citations.
4. You MUST NOT rewrite the page or produce new content.
5. **Citation density check**: Scan the draft for \`[cite:...]\` markers. If any \`##\` section has zero citations, add it to \`missing_evidence\` (e.g. "Section '## Foo' has no citations — add evidence from covered files"). Also flag any citation with a locator range spanning an entire file (e.g. \`:1-500\`) — those are too vague to be useful.
6. Return your conclusion as a single JSON object:

{
  "verdict": "pass" or "revise",
  "blockers": ["issues that prevent publication"],
  "factual_risks": ["claims not backed by evidence"],
  "missing_evidence": ["files or topics that should be cited"],
  "scope_violations": ["content outside the page plan"],
  "suggested_revisions": ["specific actionable changes"],
  "verified_citations": [
    {
      "citation": { "kind": "file", "target": "path/to/file.ts", "locator": "10-20" },
      "status": "match" | "mismatch" | "not_found",
      "note": "optional explanation"
    }
  ]
}

${strictnessRule(strictness)}
7. Be specific and actionable — "add error handling section" is better than "needs more detail".${verifyBlock}`;
}

export function buildReviewerUserPrompt(briefing: ReviewBriefing): string {
  const sections: string[] = [];

  sections.push(`## Page Title: ${briefing.page_title}`);
  sections.push(`## Section Position: ${briefing.section_position}`);
  sections.push(`## Page Plan\n${briefing.current_page_plan}`);
  sections.push(`## Full Book Summary\n${briefing.full_book_summary}`);
  sections.push(`## Covered Files\n${briefing.covered_files.join("\n")}`);
  sections.push(`## Current Draft\n\n${briefing.current_draft}`);

  if (briefing.citations.length > 0) {
    sections.push(`## Citations Used`);
    for (const c of briefing.citations) {
      sections.push(`- [${c.kind}] ${c.target}${c.locator ? `:${c.locator}` : ""}`);
    }
  }

  sections.push(`## Review Questions`);
  for (const q of briefing.review_questions) {
    sections.push(`- ${q}`);
  }

  sections.push(
    `\nReview the draft above. Use retrieval tools to verify claims. Return your conclusion as JSON.`,
  );

  return sections.join("\n\n");
}
