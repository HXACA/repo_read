import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { AskSessionRef, JobRef, PageRef, ResearchNoteRef, VersionedPageRef } from "./types.js";

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

  // --- Page Meta ---

  async loadPageMeta<T = unknown>(ref: VersionedPageRef): Promise<T | null> {
    return this.storage.readJson<T>(
      this.storage.paths.draftPageMeta(ref.projectSlug, ref.jobId, ref.versionId, ref.pageSlug),
    );
  }

  async savePageMeta(ref: VersionedPageRef, data: unknown): Promise<void> {
    return this.storage.writeJson(
      this.storage.paths.draftPageMeta(ref.projectSlug, ref.jobId, ref.versionId, ref.pageSlug),
      data,
    );
  }

  // --- Draft Markdown ---

  async saveDraftMarkdown(ref: VersionedPageRef, markdown: string): Promise<void> {
    const mdPath = this.storage.paths.draftPageMd(
      ref.projectSlug, ref.jobId, ref.versionId, ref.pageSlug,
    );
    await fs.mkdir(path.dirname(mdPath), { recursive: true });
    await fs.writeFile(mdPath, markdown, "utf-8");
  }

  // --- Citations ---

  async saveCitations(ref: VersionedPageRef, data: unknown): Promise<void> {
    return this.storage.writeJson(
      this.storage.paths.draftCitationsJson(ref.projectSlug, ref.jobId, ref.versionId, ref.pageSlug),
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

  // --- Validation ---

  async saveValidation(ref: PageRef, data: unknown): Promise<void> {
    return this.storage.writeJson(
      this.storage.paths.validationJson(ref.projectSlug, ref.jobId, ref.pageSlug),
      data,
    );
  }

  // --- Usage ---

  async saveUsage(ref: JobRef, json: string): Promise<void> {
    const usagePath = path.join(this.storage.paths.jobDir(ref.projectSlug, ref.jobId), "usage.json");
    await fs.writeFile(usagePath, json, "utf-8");
  }

  // --- Catalog (wiki.json) ---

  async saveWikiJson(ref: JobRef & { versionId: string }, data: unknown): Promise<void> {
    return this.storage.writeJson(
      this.storage.paths.draftWikiJson(ref.projectSlug, ref.jobId, ref.versionId),
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
