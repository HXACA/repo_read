import type { CitationRecord } from "./generation.js";

/**
 * A single labeled claim in a research note. Every finding must cite at
 * least one source for it to count as evidence; citation-less findings
 * belong in `unconfirmed`.
 */
export type LabeledFinding = {
  statement: string;
  citations: CitationRecord[];
};

/**
 * A persisted research note. One file per research run, written to
 * `.reporead/projects/<slug>/research/<versionId>/<id>.json`.
 *
 * The three buckets enforce PRD FR-023: research output MUST distinguish
 * between facts (directly supported by evidence), inferences (derived from
 * multiple facts), and unconfirmed (open questions or conflicting clues).
 */
export type ResearchNote = {
  id: string;
  projectSlug: string;
  versionId: string;
  topic: string;
  scope: string;
  createdAt: string;
  facts: LabeledFinding[];         // 事实 — supported by direct citations
  inferences: LabeledFinding[];    // 推断 — derived from multiple facts
  unconfirmed: LabeledFinding[];   // 待确认 — open or conflicting
  summary: string;                 // overall synthesis (1-3 paragraphs)
};
