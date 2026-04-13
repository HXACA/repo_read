import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactStore } from "../artifact-store.js";
import type { StorageAdapter } from "../../storage/storage-adapter.js";
import type { StoragePaths } from "../../storage/paths.js";

function makeStorage(): StorageAdapter {
  const paths = {
    evidenceJson: vi.fn((slug: string, jobId: string, pageSlug: string) =>
      `/${slug}/${jobId}/evidence/${pageSlug}.json`,
    ),
    outlineJson: vi.fn((slug: string, jobId: string, pageSlug: string) =>
      `/${slug}/${jobId}/outline/${pageSlug}.json`,
    ),
    reviewJson: vi.fn((slug: string, jobId: string, pageSlug: string) =>
      `/${slug}/${jobId}/review/${pageSlug}.review.json`,
    ),
    publishedIndexJson: vi.fn((slug: string, jobId: string) =>
      `/${slug}/${jobId}/published-index.json`,
    ),
    askSessionJson: vi.fn((slug: string, sessionId: string) =>
      `/${slug}/ask/${sessionId}.json`,
    ),
    researchNoteJson: vi.fn((slug: string, versionId: string, noteId: string) =>
      `/${slug}/research/${versionId}/${noteId}.json`,
    ),
  } as unknown as StoragePaths;

  return {
    paths,
    readJson: vi.fn().mockResolvedValue(null),
    writeJson: vi.fn().mockResolvedValue(undefined),
  } as unknown as StorageAdapter;
}

describe("ArtifactStore", () => {
  let storage: StorageAdapter;
  let store: ArtifactStore;

  beforeEach(() => {
    storage = makeStorage();
    store = new ArtifactStore(storage);
  });

  // --- loadEvidence ---

  it("loadEvidence delegates to evidenceJson path and readJson", async () => {
    const ref = { projectSlug: "my-proj", jobId: "job-1", pageSlug: "overview" };
    await store.loadEvidence(ref);

    expect(storage.paths.evidenceJson).toHaveBeenCalledWith("my-proj", "job-1", "overview");
    expect(storage.readJson).toHaveBeenCalledWith("/my-proj/job-1/evidence/overview.json");
  });

  // --- saveEvidence ---

  it("saveEvidence delegates to evidenceJson path and writeJson", async () => {
    const ref = { projectSlug: "my-proj", jobId: "job-1", pageSlug: "overview" };
    const data = { facts: [] };
    await store.saveEvidence(ref, data);

    expect(storage.paths.evidenceJson).toHaveBeenCalledWith("my-proj", "job-1", "overview");
    expect(storage.writeJson).toHaveBeenCalledWith(
      "/my-proj/job-1/evidence/overview.json",
      data,
    );
  });

  // --- loadOutline ---

  it("loadOutline delegates to outlineJson path and readJson", async () => {
    const ref = { projectSlug: "proj", jobId: "j2", pageSlug: "intro" };
    await store.loadOutline(ref);

    expect(storage.paths.outlineJson).toHaveBeenCalledWith("proj", "j2", "intro");
    expect(storage.readJson).toHaveBeenCalledWith("/proj/j2/outline/intro.json");
  });

  // --- saveOutline ---

  it("saveOutline delegates to outlineJson path and writeJson", async () => {
    const ref = { projectSlug: "proj", jobId: "j2", pageSlug: "intro" };
    const data = { sections: [] };
    await store.saveOutline(ref, data);

    expect(storage.paths.outlineJson).toHaveBeenCalledWith("proj", "j2", "intro");
    expect(storage.writeJson).toHaveBeenCalledWith("/proj/j2/outline/intro.json", data);
  });

  // --- saveReview ---

  it("saveReview delegates to reviewJson path and writeJson", async () => {
    const ref = { projectSlug: "proj", jobId: "j3", pageSlug: "setup" };
    const data = { score: 9 };
    await store.saveReview(ref, data);

    expect(storage.paths.reviewJson).toHaveBeenCalledWith("proj", "j3", "setup");
    expect(storage.writeJson).toHaveBeenCalledWith(
      "/proj/j3/review/setup.review.json",
      data,
    );
  });

  // --- loadPublishedIndex ---

  it("loadPublishedIndex delegates to publishedIndexJson path and readJson", async () => {
    const ref = { projectSlug: "proj", jobId: "j4" };
    await store.loadPublishedIndex(ref);

    expect(storage.paths.publishedIndexJson).toHaveBeenCalledWith("proj", "j4");
    expect(storage.readJson).toHaveBeenCalledWith("/proj/j4/published-index.json");
  });

  // --- savePublishedIndex ---

  it("savePublishedIndex delegates to publishedIndexJson path and writeJson", async () => {
    const ref = { projectSlug: "proj", jobId: "j4" };
    const data = { pages: [] };
    await store.savePublishedIndex(ref, data);

    expect(storage.paths.publishedIndexJson).toHaveBeenCalledWith("proj", "j4");
    expect(storage.writeJson).toHaveBeenCalledWith("/proj/j4/published-index.json", data);
  });

  // --- loadAskSession ---

  it("loadAskSession delegates to askSessionJson path and readJson", async () => {
    const ref = { projectSlug: "proj", sessionId: "sess-abc" };
    await store.loadAskSession(ref);

    expect(storage.paths.askSessionJson).toHaveBeenCalledWith("proj", "sess-abc");
    expect(storage.readJson).toHaveBeenCalledWith("/proj/ask/sess-abc.json");
  });

  // --- saveAskSession ---

  it("saveAskSession delegates to askSessionJson path and writeJson", async () => {
    const ref = { projectSlug: "proj", sessionId: "sess-abc" };
    const data = { turns: [] };
    await store.saveAskSession(ref, data);

    expect(storage.paths.askSessionJson).toHaveBeenCalledWith("proj", "sess-abc");
    expect(storage.writeJson).toHaveBeenCalledWith("/proj/ask/sess-abc.json", data);
  });

  // --- loadResearchNote ---

  it("loadResearchNote delegates to researchNoteJson path and readJson", async () => {
    const ref = { projectSlug: "proj", versionId: "v1", noteId: "note-xyz" };
    await store.loadResearchNote(ref);

    expect(storage.paths.researchNoteJson).toHaveBeenCalledWith("proj", "v1", "note-xyz");
    expect(storage.readJson).toHaveBeenCalledWith("/proj/research/v1/note-xyz.json");
  });

  // --- saveResearchNote ---

  it("saveResearchNote delegates to researchNoteJson path and writeJson", async () => {
    const ref = { projectSlug: "proj", versionId: "v1", noteId: "note-xyz" };
    const data = { facts: ["x"] };
    await store.saveResearchNote(ref, data);

    expect(storage.paths.researchNoteJson).toHaveBeenCalledWith("proj", "v1", "note-xyz");
    expect(storage.writeJson).toHaveBeenCalledWith(
      "/proj/research/v1/note-xyz.json",
      data,
    );
  });
});
