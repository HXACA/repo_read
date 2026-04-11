import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("doctor command", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports runDoctor function", async () => {
    const mod = await import("../../commands/doctor.js");
    expect(typeof mod.runDoctor).toBe("function");
  });

  it("reports missing project gracefully", async () => {
    const { runDoctor } = await import("../../commands/doctor.js");
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rr-doctor-"));
    // Initialize .reporead dir so StorageAdapter works
    await fs.mkdir(path.join(tmpDir, ".reporead"), { recursive: true });

    await runDoctor({ dir: tmpDir });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("not found");

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
