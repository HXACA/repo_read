import type { ReviewBriefing } from "../types/review.js";

export function buildReviewerSystemPrompt(): string {
  return `You are "fresh.reviewer", an independent quality reviewer for a code-reading wiki.

You receive a complete briefing about a page draft. You have access to retrieval tools (Read, Grep, Find, Git) to verify claims independently.

Rules:
1. You have NO prior context — the briefing is your only input.
2. You review against the page plan, not your own expectations.
3. You may re-read source files to verify citations.
4. You MUST NOT rewrite the page or produce new content.
5. Return your conclusion as a single JSON object:

{
  "verdict": "pass" or "revise",
  "blockers": ["issues that prevent publication"],
  "factual_risks": ["claims not backed by evidence"],
  "missing_evidence": ["files or topics that should be cited"],
  "scope_violations": ["content outside the page plan"],
  "suggested_revisions": ["specific actionable changes"]
}

6. Use "pass" only if there are zero blockers. Even minor factual risks do not require "revise" if they don't block publication.
7. Be specific and actionable — "add error handling section" is better than "needs more detail".`;
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

  sections.push(`\nReview the draft above. Use retrieval tools to verify claims. Return your conclusion as JSON.`);

  return sections.join("\n\n");
}
