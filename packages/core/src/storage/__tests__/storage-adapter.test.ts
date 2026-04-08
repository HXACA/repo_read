import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { StorageAdapter } from "../storage-adapter.js";

describe("StorageAdapter", () => {
  let tmpDir: string;
  let adapter: StorageAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-storage-"));
    adapter = new StorageAdapter(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("initializes .reporead directory structure", async () => {
    await adapter.initialize();
    const stat = await fs.stat(path.join(tmpDir, ".reporead"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("writes and reads JSON", async () => {
    await adapter.initialize();
    const data = { key: "value" };
    await adapter.writeJson(adapter.paths.currentJson, data);
    const read = await adapter.readJson<typeof data>(adapter.paths.currentJson);
    expect(read).toEqual(data);
  });

  it("returns null for missing file", async () => {
    await adapter.initialize();
    const read = await adapter.readJson("/nonexistent.json");
    expect(read).toBeNull();
  });

  it("ensures parent directories when writing", async () => {
    await adapter.initialize();
    const deep = path.join(adapter.paths.root, "projects", "test", "nested.json");
    await adapter.writeJson(deep, { ok: true });
    const read = await adapter.readJson<{ ok: boolean }>(deep);
    expect(read?.ok).toBe(true);
  });
});
