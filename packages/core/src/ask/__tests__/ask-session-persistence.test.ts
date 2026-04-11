import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { AskSessionManager } from "../ask-session.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";

describe("AskSessionManager persistence", () => {
  let tmpDir: string;
  let storage: StorageAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-ask-persist-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loads session from disk when not in memory", async () => {
    // Create and persist a session with the first manager
    const manager1 = new AskSessionManager(storage);
    const session = manager1.create("proj", "v1", "overview");
    manager1.addUserTurn(session.id, "What is this?");
    manager1.addAssistantTurn(session.id, "It's a test.", [
      { kind: "file", target: "test.ts" },
    ]);
    await manager1.persist(session.id);

    // Create a NEW manager — in-memory Map is empty
    const manager2 = new AskSessionManager(storage);
    const loaded = await manager2.get(session.id, "proj");

    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(session.id);
    expect(loaded!.projectSlug).toBe("proj");
    expect(loaded!.versionId).toBe("v1");
    expect(loaded!.currentPageSlug).toBe("overview");
    expect(loaded!.turns).toHaveLength(2);
    expect(loaded!.turns[0].role).toBe("user");
    expect(loaded!.turns[0].content).toBe("What is this?");
    expect(loaded!.turns[1].role).toBe("assistant");
    expect(loaded!.turns[1].citations).toHaveLength(1);
  });

  it("lists all sessions for a project", async () => {
    const manager = new AskSessionManager(storage);

    // Create 2 sessions for "proj"
    const s1 = manager.create("proj", "v1");
    manager.addUserTurn(s1.id, "Question 1");
    await manager.persist(s1.id);

    const s2 = manager.create("proj", "v1");
    manager.addUserTurn(s2.id, "Question 2");
    await manager.persist(s2.id);

    // Create 1 session for "other"
    const s3 = manager.create("other", "v1");
    manager.addUserTurn(s3.id, "Question 3");
    await manager.persist(s3.id);

    const projSessions = await manager.list("proj");
    expect(projSessions).toHaveLength(2);

    const ids = projSessions.map((s) => s.id).sort();
    expect(ids).toEqual([s1.id, s2.id].sort());
  });

  it("returns undefined for non-existent session", async () => {
    const manager = new AskSessionManager(storage);
    const result = await manager.get("non-existent-id", "proj");
    expect(result).toBeUndefined();
  });
});
