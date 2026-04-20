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
    /** Plain file path / page slug / commit hash — no line-range suffix. */
    target: string;
    /**
     * Optional line range for file citations (e.g. `"10-20"`, `"42"`).
     * Absent for page/commit kinds. Ledger consumers that render citation
     * markers should compose `[cite:kind:target:locator]`; scope checks
     * (e.g. "is `target` in `page.covered_files`?") should compare the
     * plain `target` alone.
     */
    locator?: string;
    note: string;
  }>;
  /** Page kind from the book plan — controls writing style rules. */
  page_kind?: string;
  /** What the reader should be able to do / understand after reading this page. */
  reader_goal?: string;
  /** Section name the page belongs to in the book plan. */
  section_name?: string;
  /** Slug of the previous page in reading order (for transitions). */
  previous_page_slug?: string;
  /** Slug of the next page in reading order (for transitions). */
  next_page_slug?: string;
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
  /** When coverageEnforcement != "off", the list of mechanisms the drafter
   *  should consciously cover. Mirrors the outline's covers_mechanisms but
   *  with full descriptions so the drafter doesn't need to re-read ledger. */
  mechanisms?: import("../generation/mechanism-list.js").Mechanism[];
  /** Mechanism ids the outline planner declared out-of-scope; drafter
   *  should not expand them on this page. */
  mechanisms_out_of_scope?: string[];
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
  /**
   * Mechanisms the outline planner declared out of scope for this page,
   * with a short reason (typically referencing where the mechanism is
   * covered instead). Empty when coverageEnforcement is "off".
   */
  out_of_scope_mechanisms?: Array<{ id: string; reason: string }>;
};

export type PageOutlineSection = {
  /** The `##` heading text (e.g. "核心架构"). */
  heading: string;
  /** 2-5 bullet points the section should cover. */
  key_points: string[];
  /** Evidence entries the drafter MUST cite in this section. */
  cite_from: Array<{ target: string; locator?: string }>;
  /**
   * Mechanism ids (see `deriveMechanismList`) this section is responsible
   * for covering. Empty when coverageEnforcement is "off".
   */
  covers_mechanisms?: string[];
};

export type ForkWorkerResult = {
  directive: string;
  findings: string[];
  citations: CitationRecord[];
  open_questions: string[];
};
