import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Lightweight diagnostics to help investigate pipeline hangs after the fact.
 *
 * Two features, both opt-in and best-effort:
 *
 * 1. **Heartbeat events** — a caller-supplied hook fires every `intervalMs`
 *    so the consumer (pipeline) can emit an event into the job's events.ndjson.
 *    Monitors reading the file's mtime see the stream advancing even when no
 *    other pipeline-level state transitions happen. Makes stalls immediately
 *    visible without relying on UI renderer scraping.
 *
 * 2. **SIGUSR1 handle dump** — on receiving SIGUSR1, writes a snapshot of
 *    `process.getActiveResourcesInfo()` plus the caller's phase label to a
 *    file inside the job directory. Cheap way to capture "what was Node
 *    waiting on at 05:47?" during a hang, without instrumenting every await.
 *
 * Both register on `start()` and clean up on `stop()`. Neither alters
 *  behavior; stop() is idempotent and safe to call from a finally block.
 */

export type DiagnosticsOptions = {
  /** Directory to write the handle dump into (usually the job dir). */
  dumpDir: string;
  /** Heartbeat tick callback. Called every `heartbeatMs`. */
  onHeartbeat?: (tick: number) => void;
  /** Heartbeat interval. Defaults to 60_000 (60s). */
  heartbeatMs?: number;
  /** Label written into SIGUSR1 dumps so the dump identifies the job. */
  label?: string;
  /** Opt out of the SIGUSR1 handler (e.g. in tests that own the signal). */
  enableSignalHandler?: boolean;
};

export class Diagnostics {
  private timer: NodeJS.Timeout | null = null;
  private tickCount = 0;
  private sigHandler: NodeJS.SignalsListener | null = null;
  private readonly opts: DiagnosticsOptions;

  constructor(opts: DiagnosticsOptions) {
    this.opts = opts;
  }

  start(): void {
    const heartbeatMs = this.opts.heartbeatMs ?? 60_000;
    if (this.opts.onHeartbeat) {
      const cb = this.opts.onHeartbeat;
      this.timer = setInterval(() => {
        this.tickCount += 1;
        try { cb(this.tickCount); } catch { /* best-effort */ }
      }, heartbeatMs);
      // Let the event loop exit naturally if nothing else is pending.
      if (typeof this.timer.unref === "function") this.timer.unref();
    }

    if (this.opts.enableSignalHandler !== false) {
      this.sigHandler = () => this.dumpActiveHandles();
      try {
        process.on("SIGUSR1", this.sigHandler);
      } catch {
        // Some platforms (Windows) don't support SIGUSR1 — silently skip.
        this.sigHandler = null;
      }
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.sigHandler) {
      try { process.off("SIGUSR1", this.sigHandler); } catch { /* ignore */ }
      this.sigHandler = null;
    }
  }

  /** Exposed so tests and opt-in CLI paths can trigger a dump without a real signal. */
  dumpActiveHandles(): string | null {
    try {
      // getActiveResourcesInfo is stable on Node 17+ and returns a simple
      // array of resource type names (e.g. ["TCPSocketWrap", "Timeout", ...]).
      const info = typeof (process as { getActiveResourcesInfo?: () => string[] }).getActiveResourcesInfo === "function"
        ? (process as { getActiveResourcesInfo: () => string[] }).getActiveResourcesInfo()
        : [];
      const counts = info.reduce<Record<string, number>>((acc, name) => {
        acc[name] = (acc[name] ?? 0) + 1;
        return acc;
      }, {});
      const payload = {
        ts: new Date().toISOString(),
        label: this.opts.label ?? null,
        tick: this.tickCount,
        activeResources: counts,
        memory: process.memoryUsage(),
        uptime: process.uptime(),
      };
      fs.mkdirSync(this.opts.dumpDir, { recursive: true });
      const file = path.join(
        this.opts.dumpDir,
        `hang-dump-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      );
      fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
      return file;
    } catch {
      return null;
    }
  }
}
