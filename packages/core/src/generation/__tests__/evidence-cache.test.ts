import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  serializeEvidenceCacheKey,
  buildEvidenceCacheKey,
  type EvidenceCacheKey,
} from "../evidence-cache.js";
import { ArtifactStore } from "../../artifacts/artifact-store.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";

// ---------------------------------------------------------------------------
// Key model unit tests
// ---------------------------------------------------------------------------

describe("serializeEvidenceCacheKey", () => {
  it("produces a deterministic string from a key", () => {
    const key: EvidenceCacheKey = {
      projectSlug: "my-proj",
      fileHash: "abc123",
      queryClass: "evidence-collection",
    };
    expect(serializeEvidenceCacheKey(key)).toBe(
      "my-proj::abc123::evidence-collection",
    );
  });

  it("is stable across multiple calls with the same input", () => {
    const key = buildEvidenceCacheKey("proj", "hash1", "outline-planning");
    const a = serializeEvidenceCacheKey(key);
    const b = serializeEvidenceCacheKey(key);
    expect(a).toBe(b);
  });
});

describe("buildEvidenceCacheKey", () => {
  it("round-trips correctly through serialization", () => {
    const key = buildEvidenceCacheKey("slug", "deadbeef", "evidence-collection");
    expect(key).toEqual({
      projectSlug: "slug",
      fileHash: "deadbeef",
      queryClass: "evidence-collection",
    });
    expect(serializeEvidenceCacheKey(key)).toBe(
      "slug::deadbeef::evidence-collection",
    );
  });
});

describe("different inputs produce different keys", () => {
  it("different fileHash produces different serialized key", () => {
    const a = buildEvidenceCacheKey("proj", "hash-a", "evidence-collection");
    const b = buildEvidenceCacheKey("proj", "hash-b", "evidence-collection");
    expect(serializeEvidenceCacheKey(a)).not.toBe(serializeEvidenceCacheKey(b));
  });

  it("different queryClass produces different serialized key", () => {
    const a = buildEvidenceCacheKey("proj", "hash1", "evidence-collection");
    const b = buildEvidenceCacheKey("proj", "hash1", "outline-planning");
    expect(serializeEvidenceCacheKey(a)).not.toBe(serializeEvidenceCacheKey(b));
  });

  it("different projectSlug produces different serialized key", () => {
    const a = buildEvidenceCacheKey("proj-a", "hash1", "evidence-collection");
    const b = buildEvidenceCacheKey("proj-b", "hash1", "evidence-collection");
    expect(serializeEvidenceCacheKey(a)).not.toBe(serializeEvidenceCacheKey(b));
  });
});

// ---------------------------------------------------------------------------
// ArtifactStore round-trip integration tests
// ---------------------------------------------------------------------------

describe("ArtifactStore evidence cache round-trip", () => {
  let tmpDir: string;
  let store: ArtifactStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-cache-test-"));
    const storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    store = new ArtifactStore(storage);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null for a cache miss", async () => {
    const key = buildEvidenceCacheKey("proj", "nonexistent", "evidence-collection");
    const result = await store.loadEvidenceCache(key);
    expect(result).toBeNull();
  });

  it("saves and loads the same value (round-trip)", async () => {
    const key = buildEvidenceCacheKey("proj", "abc123", "evidence-collection");
    const payload = { chunks: ["a", "b"], score: 0.95 };

    await store.saveEvidenceCache(key, payload);
    const loaded = await store.loadEvidenceCache(key);

    expect(loaded).toEqual(payload);
  });

  it("overwrites an existing cache entry", async () => {
    const key = buildEvidenceCacheKey("proj", "abc123", "evidence-collection");

    await store.saveEvidenceCache(key, { version: 1 });
    await store.saveEvidenceCache(key, { version: 2 });

    const loaded = await store.loadEvidenceCache(key);
    expect(loaded).toEqual({ version: 2 });
  });

  it("stores different keys independently", async () => {
    const keyA = buildEvidenceCacheKey("proj", "hash-a", "evidence-collection");
    const keyB = buildEvidenceCacheKey("proj", "hash-b", "evidence-collection");

    await store.saveEvidenceCache(keyA, { id: "a" });
    await store.saveEvidenceCache(keyB, { id: "b" });

    expect(await store.loadEvidenceCache(keyA)).toEqual({ id: "a" });
    expect(await store.loadEvidenceCache(keyB)).toEqual({ id: "b" });
  });
});
