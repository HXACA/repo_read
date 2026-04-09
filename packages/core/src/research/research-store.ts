import * as fs from "node:fs/promises";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { ResearchNote } from "../types/research.js";

/**
 * CRUD for {@link ResearchNote} objects on disk. Notes are keyed by UUID
 * within a `<slug>/research/<versionId>/` directory.
 */
export class ResearchStore {
  constructor(private readonly storage: StorageAdapter) {}

  async save(note: ResearchNote): Promise<void> {
    const path = this.storage.paths.researchNoteJson(
      note.projectSlug,
      note.versionId,
      note.id,
    );
    await this.storage.writeJson(path, note);
  }

  async get(
    slug: string,
    versionId: string,
    noteId: string,
  ): Promise<ResearchNote | null> {
    const path = this.storage.paths.researchNoteJson(slug, versionId, noteId);
    return this.storage.readJson<ResearchNote>(path);
  }

  async list(slug: string, versionId: string): Promise<ResearchNote[]> {
    const dir = this.storage.paths.researchDir(slug, versionId);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }

    const notes: ResearchNote[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const id = entry.slice(0, -".json".length);
      const note = await this.get(slug, versionId, id);
      if (note) notes.push(note);
    }

    // Newest first
    notes.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return notes;
  }
}
