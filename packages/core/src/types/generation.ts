import type { ResolvedConfig } from "./config.js";
import type { PageKind } from "../book/page-kind.js";

export type JobStatus =
  | "queued"
  | "cataloging"
  | "page_drafting"
  | "reviewing"
  | "validating"
  | "publishing"
  | "completed"
  | "interrupted"
  | "failed";

export type GenerationJob = {
  id: string;
  projectSlug: string;
  repoRoot: string;
  versionId: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  configSnapshot: ResolvedConfig;
  currentPageSlug?: string;
  nextPageOrder?: number;
  lastError?: string;
  summary: {
    totalPages?: number;
    succeededPages?: number;
    failedPages?: number;
  };
};

export type WikiJson = {
  summary: string;
  language?: string;
  reading_order: Array<{
    slug: string;
    title: string;
    rationale: string;
    covered_files: string[];
    /** Logical section grouping (e.g. "Getting Started", "Core Architecture"). */
    section?: string;
    /** Optional sub-group within a section (e.g. "Backend Engine"). */
    group?: string;
    /** Difficulty level for this page. */
    level?: "beginner" | "intermediate" | "advanced";
    /** Page archetype from the 4-kind book system. */
    kind?: PageKind;
    /** One-sentence reader goal for this page. */
    readerGoal?: string;
    /** Slugs of prerequisite pages.
     *  v1: stored but not yet consumed by validator, drafter, or publish order.
     *  Reserved for B3 Editorial Pass (dependency-based reordering). */
    prerequisites?: string[];
  }>;
};

export type PageStatus = "drafted" | "reviewed" | "validated" | "published";

export type PageMeta = {
  slug: string;
  title: string;
  order: number;
  sectionId: string;
  section?: string;
  group?: string;
  level?: "beginner" | "intermediate" | "advanced";
  kind?: PageKind;
  readerGoal?: string;
  prerequisites?: string[];
  coveredFiles: string[];
  relatedPages: string[];
  generatedAt: string;
  commitHash: string;
  citationFile: string;
  summary: string;
  reviewStatus: "accepted" | "accepted_with_notes" | "unverified";
  reviewSummary: string;
  reviewDigest: string;
  revisionAttempts?: number;
  status: PageStatus;
  validation: {
    structurePassed: boolean;
    mermaidPassed: boolean;
    citationsPassed: boolean;
    linksPassed: boolean;
    summary: "passed" | "failed";
  };
};

export type CitationKind = "file" | "page" | "commit";

export type CitationRecord = {
  kind: CitationKind;
  target: string;
  locator?: string;
  note?: string;
};

export type VersionJson = {
  versionId: string;
  projectSlug: string;
  commitHash: string;
  createdAt: string;
  pageCount: number;
  pages: Array<{
    slug: string;
    title: string;
    order: number;
    status: PageStatus;
    section?: string;
    group?: string;
    level?: "beginner" | "intermediate" | "advanced";
    kind?: PageKind;
  }>;
  summary: string;
};
