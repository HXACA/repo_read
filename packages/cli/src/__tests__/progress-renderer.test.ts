import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProgressRenderer } from "../progress-renderer.js";
import type { AppEvent } from "@reporead/core";

describe("ProgressRenderer", () => {
  let renderer: ProgressRenderer;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    renderer = new ProgressRenderer();
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    renderer.stop();
    vi.restoreAllMocks();
  });

  it("setPageList initializes pages without throwing", () => {
    renderer.setPageList([
      { slug: "overview", title: "Overview" },
      { slug: "core", title: "Core" },
    ]);
    const event: AppEvent = {
      id: "1",
      channel: "job",
      type: "page.evidence_planned",
      at: new Date().toISOString(),
      projectId: "proj",
      pageSlug: "overview",
      payload: {},
    };
    expect(() => renderer.onEvent(event)).not.toThrow();
  });

  it("setResumeSkipped marks pages as skipped", () => {
    renderer.setPageList([
      { slug: "a", title: "A" },
      { slug: "b", title: "B" },
      { slug: "c", title: "C" },
    ]);
    renderer.setResumeSkipped(2);
    const event: AppEvent = {
      id: "2",
      channel: "job",
      type: "page.evidence_planned",
      at: new Date().toISOString(),
      projectId: "proj",
      pageSlug: "c",
      payload: {},
    };
    expect(() => renderer.onEvent(event)).not.toThrow();
  });

  it("printSummary outputs success info", () => {
    renderer.setPageList([{ slug: "a", title: "A" }]);
    renderer.printSummary(true, {
      versionId: "2026-04-11",
      id: "job-1",
      summary: { succeededPages: 1, totalPages: 1 },
    });
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("生成完成");
    expect(output).toContain("2026-04-11");
  });

  it("printSummary outputs failure info with resume command", () => {
    renderer.printSummary(false, {
      versionId: "v1",
      id: "job-fail",
      summary: {},
    });
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("生成失败");
    expect(output).toContain("--resume");
  });
});
