import { describe, it, expect, afterEach, vi } from "vitest";
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

  describe("wake-from-sleep detector", () => {
    it("fires onWake when Date.now() drift exceeds wakeDriftThresholdMs", () => {
      vi.useFakeTimers();
      try {
        const dir = tmpdir();
        cleanup.push(dir);
        const wakes: Array<{ drift: number; actual: number; expected: number }> = [];
        let mockNow = 0;
        const diag = new Diagnostics({
          dumpDir: dir,
          enableSignalHandler: false,
          wakeCheckMs: 100,
          wakeDriftThresholdMs: 30_000,
          now: () => mockNow,
          onWake: (drift, expected, actual) => wakes.push({ drift, expected, actual }),
        });
        diag.start();

        // Normal tick: 100ms elapsed, matches interval, no drift.
        mockNow = 100;
        vi.advanceTimersByTime(100);
        expect(wakes).toHaveLength(0);

        // Simulate the process being paused for ~35s while the interval
        // timer "catches up" on the next tick.
        mockNow = 35_200;
        vi.advanceTimersByTime(100);

        expect(wakes).toHaveLength(1);
        expect(wakes[0].drift).toBeGreaterThanOrEqual(30_000);
        expect(wakes[0].expected).toBe(100);
        expect(wakes[0].actual).toBe(35_100);

        diag.stop();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not fire onWake for drift within threshold (GC jitter, normal backpressure)", () => {
      vi.useFakeTimers();
      try {
        const dir = tmpdir();
        cleanup.push(dir);
        const wakes: number[] = [];
        let mockNow = 0;
        const diag = new Diagnostics({
          dumpDir: dir,
          enableSignalHandler: false,
          wakeCheckMs: 100,
          wakeDriftThresholdMs: 30_000,
          now: () => mockNow,
          onWake: (drift) => wakes.push(drift),
        });
        diag.start();

        // 20s drift — well above typical GC pause but below threshold.
        mockNow = 20_100;
        vi.advanceTimersByTime(100);
        expect(wakes).toHaveLength(0);
        diag.stop();
      } finally {
        vi.useRealTimers();
      }
    });

    it("rotates the wakeSignal: old signal aborts, new signal is fresh", () => {
      vi.useFakeTimers();
      try {
        const dir = tmpdir();
        cleanup.push(dir);
        let mockNow = 0;
        const diag = new Diagnostics({
          dumpDir: dir,
          enableSignalHandler: false,
          wakeCheckMs: 100,
          wakeDriftThresholdMs: 30_000,
          now: () => mockNow,
          onWake: () => {},
        });
        diag.start();

        const beforeSignal = diag.wakeSignal;
        expect(beforeSignal.aborted).toBe(false);

        mockNow = 40_100;
        vi.advanceTimersByTime(100);

        expect(beforeSignal.aborted).toBe(true);
        const afterSignal = diag.wakeSignal;
        expect(afterSignal).not.toBe(beforeSignal);
        expect(afterSignal.aborted).toBe(false);

        diag.stop();
      } finally {
        vi.useRealTimers();
      }
    });

    it("stop clears the wake detection interval", () => {
      vi.useFakeTimers();
      try {
        const dir = tmpdir();
        cleanup.push(dir);
        const wakes: number[] = [];
        let mockNow = 0;
        const diag = new Diagnostics({
          dumpDir: dir,
          enableSignalHandler: false,
          wakeCheckMs: 100,
          wakeDriftThresholdMs: 30_000,
          now: () => mockNow,
          onWake: (drift) => wakes.push(drift),
        });
        diag.start();
        diag.stop();

        // After stop, even a 60s jump shouldn't fire anything.
        mockNow = 60_000;
        vi.advanceTimersByTime(1000);
        expect(wakes).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not install the wake detector when onWake is not provided", () => {
      vi.useFakeTimers();
      try {
        const dir = tmpdir();
        cleanup.push(dir);
        let mockNow = 0;
        const diag = new Diagnostics({
          dumpDir: dir,
          enableSignalHandler: false,
          wakeCheckMs: 100,
          now: () => mockNow,
          // no onWake → detector must not arm
        });
        diag.start();

        // wakeSignal getter should still work but no wake ever fires.
        const sig1 = diag.wakeSignal;
        mockNow = 60_000;
        vi.advanceTimersByTime(100);
        const sig2 = diag.wakeSignal;
        expect(sig1).toBe(sig2);
        expect(sig1.aborted).toBe(false);
        diag.stop();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
