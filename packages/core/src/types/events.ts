export type EventChannel = "job" | "chat" | "research";

export type AppEvent<T = unknown> = {
  id: string;
  channel: EventChannel;
  type: string;
  at: string;
  projectId: string;
  jobId?: string;
  versionId?: string;
  pageSlug?: string;
  sessionId?: string;
  payload: T;
};

export type AskSession = {
  id: string;
  projectSlug: string;
  versionId: string;
  mode: "ask" | "research";
  currentPageSlug?: string;
  turns: Array<{
    role: "user" | "assistant";
    content: string;
    citations: import("./generation.js").CitationRecord[];
  }>;
  compactSummary?: string;
  updatedAt: string;
};
