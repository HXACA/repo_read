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
   * by the EvidenceCoordinator's fork.worker subtasks. The drafter treats
   * findings as "already-verified facts to draw from" and open_questions as
   * "things the coordinator couldn't resolve — worth verifying with tools".
   */
  evidence_bundle?: {
    findings: string[];
    open_questions: string[];
  };
  /** Optional revision context — set when re-drafting after a "revise" verdict */
  revision?: {
    attempt: number;
    previous_draft: string;
    feedback: ReviewConclusion;
  };
};

export type ForkWorkerResult = {
  directive: string;
  findings: string[];
  citations: CitationRecord[];
  open_questions: string[];
};
