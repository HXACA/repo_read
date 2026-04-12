import type { CitationRecord } from "./generation.js";
import type { ReviewConclusion } from "./review.js";

export type MainAuthorContext = {
  project_summary: string;
  full_book_summary: string;
  current_page_plan?: string;
  published_page_summaries: Array<{
    slug: string;
    title: string;
    summary: string;
  }>;
  evidence_ledger: Array<{
    id: string;
    kind: "file" | "page" | "commit";
    target: string;
    note: string;
  }>;
  /**
   * Optional bundle of natural-language findings and open questions produced
   * by the EvidenceCoordinator's worker subtasks. The drafter treats
   * findings as "already-verified facts to draw from" and open_questions as
   * "things the coordinator couldn't resolve — worth verifying with tools".
   */
  evidence_bundle?: {
    findings: string[];
    open_questions: string[];
  };
  /**
   * Structured outline produced by the OutlinePlanner. Each section maps
   * to specific evidence_ledger entries so the drafter knows exactly what
   * to cite in each `##` heading.
   */
  page_outline?: PageOutline;
  /** File path to evidence JSON — drafter can read via tool */
  evidence_file?: string;
  /** File path to outline JSON — drafter can read via tool */
  outline_file?: string;
  /** File path to published summaries index */
  published_index_file?: string;
  /** File path to previous draft (for revision) */
  draft_file?: string;
  /** Optional revision context — set when re-drafting after a "revise" verdict */
  revision?: {
    attempt: number;
    previous_draft: string;
    feedback: ReviewConclusion;
  };
};

/**
 * Structured outline for a single wiki page. Produced by the
 * OutlinePlanner between evidence collection and drafting.
 */
export type PageOutline = {
  sections: PageOutlineSection[];
};

export type PageOutlineSection = {
  /** The `##` heading text (e.g. "核心架构"). */
  heading: string;
  /** 2-5 bullet points the section should cover. */
  key_points: string[];
  /** Evidence entries the drafter MUST cite in this section. */
  cite_from: Array<{ target: string; locator?: string }>;
};

export type ForkWorkerResult = {
  directive: string;
  findings: string[];
  citations: CitationRecord[];
  open_questions: string[];
};
