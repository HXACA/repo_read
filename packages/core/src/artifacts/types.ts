export type PageRef = { projectSlug: string; jobId: string; pageSlug: string };
export type VersionedPageRef = PageRef & { versionId: string };
export type JobRef = { projectSlug: string; jobId: string };
export type AskSessionRef = { projectSlug: string; sessionId: string };
export type ResearchNoteRef = { projectSlug: string; versionId: string; noteId: string };
