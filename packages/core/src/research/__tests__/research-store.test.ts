import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { ResearchStore } from "../research-store.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import type { ResearchNote } from "../../types/research.js";

function makeNote(overrides: Partial<ResearchNote> = {}): ResearchNote {
  return {
    id: randomUUID(),
    projectSlug: "proj",
    versionId: "v1",
    topic: "test topic",
    scope: "test scope",
    createdAt: new Date().toISOString(),
    facts: [],
    inferences: [],
    unconfirmed: [],
    summary: "test summary",
    ...overrides,
  };
}

describe("ResearchStore", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let store: ResearchStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-research-store-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    store = new ResearchStore(storage);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("save + get round-trips a note", async () => {
    const note = makeNote({
      topic: "How does auth work",
      facts: [
        {
          statement: "JWT tokens are signed with HS256",
          citations: [
            { kind: "file", target: "auth.ts", locator: "12-20" },
          ],
        },
      ],
    });

    await store.save(note);
    const loaded = await store.get(note.projectSlug, note.versionId, note.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.topic).toBe("How does auth work");
    expect(loaded!.facts).toHaveLength(1);
  });

  it("get returns null for missing note", async () => {
    const loaded = await store.get("proj", "v1", "missing-id");
    expect(loaded).toBeNull();
  });

  it("list returns notes newest first", async () => {
    const older = makeNote({
      topic: "older",
      createdAt: "2026-04-08T00:00:00.000Z",
    });
    const newer = makeNote({
      topic: "newer",
      createdAt: "2026-04-10T00:00:00.000Z",
    });

    await store.save(older);
    await store.save(newer);

    const list = await store.list("proj", "v1");
    expect(list).toHaveLength(2);
    expect(list[0].topic).toBe("newer");
    expect(list[1].topic).toBe("older");
  });

  it("list returns empty array when dir missing", async () => {
    const list = await store.list("nonexistent", "v1");
    expect(list).toEqual([]);
  });

  it("ignores non-json files in the directory", async () => {
    const note = makeNote();
    await store.save(note);

    // Drop a stray file next to the real note
    const dir = storage.paths.researchDir("proj", "v1");
    await fs.writeFile(path.join(dir, "README.txt"), "ignore me", "utf-8");

    const list = await store.list("proj", "v1");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(note.id);
  });
});
