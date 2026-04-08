import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { createSSEStream, formatSSE } from "../sse-adapter.js";
import { EventWriter } from "../event-writer.js";
import { createAppEvent } from "../app-event.js";

describe("formatSSE", () => {
  it("formats event as SSE text", () => {
    const event = createAppEvent("job", "job.started", "proj", { foo: "bar" }, { jobId: "j1" });
    const sse = formatSSE(event);
    expect(sse).toContain(`id: ${event.id}`);
    expect(sse).toContain("event: job.started");
    expect(sse).toContain("data: ");
    expect(sse.endsWith("\n\n")).toBe(true);
  });
});

describe("createSSEStream", () => {
  let tmpDir: string;
  let eventsPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-sse-"));
    eventsPath = path.join(tmpDir, "events.ndjson");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("streams all events as SSE", async () => {
    const writer = new EventWriter(eventsPath);
    const e1 = createAppEvent("job", "job.started", "proj", {});
    const e2 = createAppEvent("job", "catalog.completed", "proj", { totalPages: 3 });
    await writer.write(e1);
    await writer.write(e2);

    const stream = createSSEStream(eventsPath);
    const reader = stream.getReader();
    const chunks: string[] = [];
    let done = false;
    while (!done) {
      const result = await reader.read();
      if (result.done) { done = true; break; }
      chunks.push(result.value);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain("event: job.started");
    expect(chunks[1]).toContain("event: catalog.completed");
  });

  it("streams events since a specific event ID", async () => {
    const writer = new EventWriter(eventsPath);
    const e1 = createAppEvent("job", "job.started", "proj", {});
    const e2 = createAppEvent("job", "catalog.completed", "proj", {});
    const e3 = createAppEvent("job", "page.drafting", "proj", {});
    await writer.write(e1);
    await writer.write(e2);
    await writer.write(e3);

    const stream = createSSEStream(eventsPath, e1.id);
    const reader = stream.getReader();
    const chunks: string[] = [];
    let done = false;
    while (!done) {
      const result = await reader.read();
      if (result.done) { done = true; break; }
      chunks.push(result.value);
    }

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain("event: catalog.completed");
    expect(chunks[1]).toContain("event: page.drafting");
  });

  it("returns empty stream for nonexistent file", async () => {
    const stream = createSSEStream(path.join(tmpDir, "nonexistent.ndjson"));
    const reader = stream.getReader();
    const result = await reader.read();
    expect(result.done).toBe(true);
  });
});
