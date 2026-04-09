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

/**
 * A citation that the reviewer was asked to verify with the `read` tool.
 *
 * - `match`: the cited lines exist and contain the claimed content (±5 line drift
 *   and symbol-name equivalence are allowed).
 * - `mismatch`: the cited lines exist but do not match what the draft claims.
 * - `not_found`: the target file or line range does not exist.
 *
 * Any non-`match` entry is automatically promoted to a blocker by the
 * pipeline, regardless of whether the reviewer wrote it into `blockers`.
 */
export type VerifiedCitation = {
  citation: {
    kind: "file" | "page" | "commit";
    target: string;
    locator?: string;
  };
  status: "match" | "mismatch" | "not_found";
  note?: string;
};

export type ReviewConclusion = {
  verdict: ReviewVerdict;
  blockers: string[];
  factual_risks: string[];
  missing_evidence: string[];
  scope_violations: string[];
  suggested_revisions: string[];
  /**
   * Optional: citations the reviewer verified against source. Populated only
   * when the quality profile sets `reviewerVerifyMinCitations > 0`. Older
   * review.json files may not have this field.
   */
  verified_citations?: VerifiedCitation[];
};
