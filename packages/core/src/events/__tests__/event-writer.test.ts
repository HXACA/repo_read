import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { EventWriter } from "../event-writer.js";
import { createAppEvent } from "../app-event.js";

describe("EventWriter", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-events-"));
    filePath = path.join(tmpDir, "events.ndjson");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes an event as ndjson line", async () => {
    const writer = new EventWriter(filePath);
    const event = createAppEvent("job", "job.started", "proj-1", { jobId: "j1" });
    await writer.write(event);

    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe("job.started");
    expect(parsed.payload.jobId).toBe("j1");
  });

  it("appends multiple events on separate lines", async () => {
    const writer = new EventWriter(filePath);
    await writer.write(createAppEvent("job", "job.started", "p1", {}));
    await writer.write(createAppEvent("job", "catalog.completed", "p1", {}));

    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});
