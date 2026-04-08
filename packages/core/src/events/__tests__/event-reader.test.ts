import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { EventWriter } from "../event-writer.js";
import { EventReader } from "../event-reader.js";
import { createAppEvent } from "../app-event.js";

describe("EventReader", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-events-"));
    filePath = path.join(tmpDir, "events.ndjson");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("reads all events from ndjson", async () => {
    const writer = new EventWriter(filePath);
    await writer.write(createAppEvent("job", "job.started", "p1", { a: 1 }));
    await writer.write(createAppEvent("job", "catalog.completed", "p1", { b: 2 }));

    const reader = new EventReader(filePath);
    const events = await reader.readAll();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("job.started");
    expect(events[1].type).toBe("catalog.completed");
  });

  it("reads events after a given event ID", async () => {
    const writer = new EventWriter(filePath);
    const e1 = createAppEvent("job", "job.started", "p1", {});
    const e2 = createAppEvent("job", "catalog.completed", "p1", {});
    await writer.write(e1);
    await writer.write(e2);

    const reader = new EventReader(filePath);
    const events = await reader.readSince(e1.id);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(e2.id);
  });

  it("returns empty array for nonexistent file", async () => {
    const reader = new EventReader("/nonexistent.ndjson");
    const events = await reader.readAll();
    expect(events).toHaveLength(0);
  });
});
