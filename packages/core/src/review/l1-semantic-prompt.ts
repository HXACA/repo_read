import type { ReviewBriefing } from "../types/review.js";
import type { ReviewerStrictness } from "./reviewer-prompt.js";

function l1StrictnessRule(strictness: ReviewerStrictness): string {
  switch (strictness) {
    case "strict":
      return `5. Return "pass" ONLY if you see zero scope violations and every section has citations. Any unsupported claim forces "revise".`;
    case "lenient":
      return `5. Return "pass" unless there are clear scope violations or entire sections without any evidence. Minor gaps are acceptable.`;
    case "normal":
    default:
      return `5. Return "pass" if there are no blockers. Flag factual risks and missing evidence as notes, not blockers, unless they are severe.`;
  }
}

export function buildL1SystemPrompt(strictness: ReviewerStrictness = "normal"): string {
  return `You are a lightweight semantic reviewer for a code-reading wiki page.

You perform a QUICK semantic review — no file reading, no tool calls. You evaluate
the draft based ONLY on the text provided to you.

Rules:
1. You have NO access to the repository. Do NOT hallucinate file contents.
2. Check if the draft stays within the scope described in the page plan.
3. Check if each ## section has at least one [cite:...] marker. Flag sections with zero citations.
4. Flag any bold claim (performance numbers, exact behavior, specific limitations) that has no citation.
${l1StrictnessRule(strictness)}
6. Return your conclusion as a single JSON object:

{
  "verdict": "pass" or "revise",
  "blockers": ["issues that prevent publication"],
  "factual_risks": ["claims not backed by evidence"],
  "missing_evidence": ["sections or topics lacking citations"],
  "scope_violations": ["content outside the page plan"],
  "suggested_revisions": ["specific actionable changes"]
}

Be concise. You are a fast gate, not an exhaustive reviewer.`;
}

export function buildL1UserPrompt(briefing: ReviewBriefing, draftContent: string): string {
  const sections: string[] = [];

  sections.push(`## Page Title: ${briefing.page_title}`);
  sections.push(`## Section Position: ${briefing.section_position}`);
  sections.push(`## Page Plan\n${briefing.current_page_plan}`);
  sections.push(`## Covered Files\n${briefing.covered_files.join("\n")}`);

  if (briefing.previous_review) {
    const prev = briefing.previous_review;
    sections.push(`## Previous Review Issues`);
    if (prev.blockers.length > 0) {
      sections.push(`**Blockers:**\n${prev.blockers.map((b) => `- ${b}`).join("\n")}`);
    }
    if (prev.factual_risks.length > 0) {
      sections.push(`**Factual risks:**\n${prev.factual_risks.map((r) => `- ${r}`).join("\n")}`);
    }
  }

  sections.push(`## Draft Content\n\n${draftContent}`);
  sections.push(`\nReview the draft for scope compliance, citation density, and unsupported claims. Return your conclusion as JSON.`);

  return sections.join("\n\n");
}
