import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { AskSessionManager } from "../ask-session.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";

describe("AskSessionManager", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let manager: AskSessionManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-ask-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    manager = new AskSessionManager(storage);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a session with unique ID", () => {
    const session = manager.create("proj", "v1", "overview");
    expect(session.id).toBeDefined();
    expect(session.projectSlug).toBe("proj");
    expect(session.versionId).toBe("v1");
    expect(session.currentPageSlug).toBe("overview");
    expect(session.turns).toHaveLength(0);
  });

  it("retrieves created session", () => {
    const session = manager.create("proj", "v1");
    const retrieved = manager.get(session.id);
    expect(retrieved).toBe(session);
  });

  it("adds user and assistant turns", () => {
    const session = manager.create("proj", "v1");
    manager.addUserTurn(session.id, "What is this?");
    manager.addAssistantTurn(session.id, "It's a test.", [
      { kind: "file", target: "test.ts" },
    ]);

    expect(session.turns).toHaveLength(2);
    expect(session.turns[0].role).toBe("user");
    expect(session.turns[1].role).toBe("assistant");
    expect(session.turns[1].citations).toHaveLength(1);
  });

  it("persists session to storage", async () => {
    const session = manager.create("proj", "v1");
    manager.addUserTurn(session.id, "Hello");
    await manager.persist(session.id);

    const filePath = `${storage.paths.projectDir("proj")}/ask/${session.id}.json`;
    const exists = await storage.exists(filePath);
    expect(exists).toBe(true);
  });
});
