import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { AskSessionRef, JobRef, PageRef, ResearchNoteRef } from "./types.js";

export class ArtifactStore {
  constructor(private readonly storage: StorageAdapter) {}

  // --- Evidence ---

  async loadEvidence<T = unknown>(ref: PageRef): Promise<T | null> {
    return this.storage.readJson<T>(
      this.storage.paths.evidenceJson(ref.projectSlug, ref.jobId, ref.pageSlug),
    );
  }

  async saveEvidence(ref: PageRef, data: unknown): Promise<void> {
    return this.storage.writeJson(
      this.storage.paths.evidenceJson(ref.projectSlug, ref.jobId, ref.pageSlug),
      data,
    );
  }

  // --- Outline ---

  async loadOutline<T = unknown>(ref: PageRef): Promise<T | null> {
    return this.storage.readJson<T>(
      this.storage.paths.outlineJson(ref.projectSlug, ref.jobId, ref.pageSlug),
    );
  }

  async saveOutline(ref: PageRef, data: unknown): Promise<void> {
    return this.storage.writeJson(
      this.storage.paths.outlineJson(ref.projectSlug, ref.jobId, ref.pageSlug),
      data,
    );
  }

  // --- Review ---

  async saveReview(ref: PageRef, data: unknown): Promise<void> {
    return this.storage.writeJson(
      this.storage.paths.reviewJson(ref.projectSlug, ref.jobId, ref.pageSlug),
      data,
    );
  }

  // --- Published Index ---

  async loadPublishedIndex<T = unknown>(ref: JobRef): Promise<T | null> {
    return this.storage.readJson<T>(
      this.storage.paths.publishedIndexJson(ref.projectSlug, ref.jobId),
    );
  }

  async savePublishedIndex(ref: JobRef, data: unknown): Promise<void> {
    return this.storage.writeJson(
      this.storage.paths.publishedIndexJson(ref.projectSlug, ref.jobId),
      data,
    );
  }

  // --- Ask Session ---

  async loadAskSession<T = unknown>(ref: AskSessionRef): Promise<T | null> {
    return this.storage.readJson<T>(
      this.storage.paths.askSessionJson(ref.projectSlug, ref.sessionId),
    );
  }

  async saveAskSession(ref: AskSessionRef, data: unknown): Promise<void> {
    return this.storage.writeJson(
      this.storage.paths.askSessionJson(ref.projectSlug, ref.sessionId),
      data,
    );
  }

  // --- Research Note ---

  async loadResearchNote<T = unknown>(ref: ResearchNoteRef): Promise<T | null> {
    return this.storage.readJson<T>(
      this.storage.paths.researchNoteJson(ref.projectSlug, ref.versionId, ref.noteId),
    );
  }

  async saveResearchNote(ref: ResearchNoteRef, data: unknown): Promise<void> {
    return this.storage.writeJson(
      this.storage.paths.researchNoteJson(ref.projectSlug, ref.versionId, ref.noteId),
      data,
    );
  }
}
