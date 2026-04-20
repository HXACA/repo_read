import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Diagnostics } from "../diagnostics.js";

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "diag-"));
}

describe("Diagnostics", () => {
  const cleanup: string[] = [];
  afterEach(() => {
    for (const d of cleanup) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    cleanup.length = 0;
  });

  it("invokes the heartbeat callback at roughly the configured interval", async () => {
    const dir = tmpdir();
    cleanup.push(dir);
    const ticks: number[] = [];
    const diag = new Diagnostics({
      dumpDir: dir,
      heartbeatMs: 20,
      onHeartbeat: (t) => ticks.push(t),
      enableSignalHandler: false,
    });
    diag.start();
    await new Promise((r) => setTimeout(r, 90));
    diag.stop();

    // Expect at least 2 ticks (conservative for flaky CI)
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    // Monotonic counter
    expect(ticks).toEqual(ticks.slice().sort((a, b) => a - b));
    expect(ticks[0]).toBe(1);
  });

  it("stop clears the timer so no further ticks fire", async () => {
    const dir = tmpdir();
    cleanup.push(dir);
    const ticks: number[] = [];
    const diag = new Diagnostics({
      dumpDir: dir,
      heartbeatMs: 20,
      onHeartbeat: (t) => ticks.push(t),
      enableSignalHandler: false,
    });
    diag.start();
    await new Promise((r) => setTimeout(r, 45));
    const countAtStop = ticks.length;
    diag.stop();
    await new Promise((r) => setTimeout(r, 60));
    expect(ticks.length).toBe(countAtStop);
  });

  it("stop is idempotent", () => {
    const dir = tmpdir();
    cleanup.push(dir);
    const diag = new Diagnostics({ dumpDir: dir, enableSignalHandler: false });
    diag.start();
    diag.stop();
    // Second call must not throw
    expect(() => diag.stop()).not.toThrow();
  });

  it("dumpActiveHandles writes a JSON snapshot to the dump dir", () => {
    const dir = tmpdir();
    cleanup.push(dir);
    const diag = new Diagnostics({
      dumpDir: dir,
      label: "test-job/abc",
      enableSignalHandler: false,
    });
    diag.start();
    const file = diag.dumpActiveHandles();
    diag.stop();

    expect(file).toBeTruthy();
    expect(fs.existsSync(file!)).toBe(true);
    const dump = JSON.parse(fs.readFileSync(file!, "utf-8"));
    expect(dump.label).toBe("test-job/abc");
    expect(typeof dump.ts).toBe("string");
    expect(dump.memory).toBeDefined();
    expect(typeof dump.memory.rss).toBe("number");
    expect(dump.activeResources).toBeDefined();
  });

  it("dumpActiveHandles reports the current tick count", async () => {
    const dir = tmpdir();
    cleanup.push(dir);
    const diag = new Diagnostics({
      dumpDir: dir,
      heartbeatMs: 10,
      onHeartbeat: () => {},
      enableSignalHandler: false,
    });
    diag.start();
    await new Promise((r) => setTimeout(r, 50));
    const file = diag.dumpActiveHandles();
    diag.stop();

    const dump = JSON.parse(fs.readFileSync(file!, "utf-8"));
    expect(dump.tick).toBeGreaterThan(0);
  });

  it("creates the dump directory if it does not exist", () => {
    const dir = path.join(tmpdir(), "nested", "deep");
    cleanup.push(path.dirname(path.dirname(dir)));
    const diag = new Diagnostics({ dumpDir: dir, enableSignalHandler: false });
    diag.start();
    const file = diag.dumpActiveHandles();
    diag.stop();

    expect(fs.existsSync(file!)).toBe(true);
  });
});
