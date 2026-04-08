import type { CitationRecord } from "./generation.js";

export type ReviewBriefing = {
  page_title: string;
  section_position: string;
  current_page_plan: string;
  full_book_summary: string;
  current_draft: string;
  citations: CitationRecord[];
  covered_files: string[];
  review_questions: string[];
};

export type ReviewVerdict = "pass" | "revise";

export type ReviewConclusion = {
  verdict: ReviewVerdict;
  blockers: string[];
  factual_risks: string[];
  missing_evidence: string[];
  scope_violations: string[];
  suggested_revisions: string[];
};
