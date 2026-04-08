import type { CitationRecord } from "./generation.js";

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
};

export type ForkWorkerResult = {
  directive: string;
  findings: string[];
  citations: CitationRecord[];
  open_questions: string[];
};
