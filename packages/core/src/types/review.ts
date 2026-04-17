export type ReviewBriefing = {
  page_title: string;
  section_position: string;
  current_page_plan: string;
  full_book_summary: string;
  draft_file: string;
  covered_files: string[];
  published_summaries_file?: string;
  review_questions: string[];
  /** Present when this is a differential review on a revision. */
  previous_review?: ReviewConclusion;
  /** Human-readable summary of what changed since the previous review. */
  revision_diff_summary?: string;
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
  /**
   * Mechanism ids the reviewer judged as not adequately covered in the
   * draft. Derived from `deriveMechanismList` and pre-filtered to exclude
   * items the outline declared out-of-scope. Non-empty in strict mode
   * forces `verdict = "revise"` and triggers a re-draft (never re-evidence).
   * Older review.json files will not have this field.
   */
  missing_coverage?: string[];
  suggested_revisions: string[];
  /**
   * Optional: citations the reviewer verified against source. Populated only
   * when the quality profile sets `reviewerVerifyMinCitations > 0`. Older
   * review.json files may not have this field.
   */
  verified_citations?: VerifiedCitation[];
};
