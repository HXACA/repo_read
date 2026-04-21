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
 * behavior; stop() is idempotent and safe to call from a finally block.
 *
 * **Scope limitation**: the heartbeat-driven stall detector catches
 * async-await hangs (orphan promise, leaked permit, hung SSE stream).
 * It does NOT catch event-loop blocks — if a synchronous CPU-bound loop
 * freezes the runtime, the heartbeat timer itself can't fire and no
 * `job.stalled` event will be emitted. That failure mode is rare in
 * RepoRead's pipeline (all hot paths are I/O-bound) but worth knowing
 * when triaging an unresponsive process: if SIGUSR1 also yields nothing,
 * suspect an event-loop block and attach `node --inspect-brk`.
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
  /**
   * Wake-from-sleep callback. Called when the measured `Date.now()` delta
   * between consecutive internal checks exceeds `wakeDriftThresholdMs`.
   *
   * The reference case is macOS Idle Sleep: the Node event loop pauses
   * for minutes/hours while the kernel continues TCP keepalive. On resume
   * the process holds references to sockets the remote has long since
   * closed; every in-flight fetch hangs until `WallClockTimeoutError`
   * fires — except `setTimeout` counts process-runtime, not wall-clock,
   * so even that timer has most of its budget still left to burn.
   *
   * Providing `onWake` arms a second `setInterval(wakeCheckMs)` that
   * compares `Date.now()` against the previous tick. When drift exceeds
   * the threshold:
   *   1. The internal `wakeController` is swapped for a fresh one.
   *   2. The OLD controller aborts, propagating to any fetch that
   *      subscribed via `createWallClockFetch({ wakeSignal: ... })`.
   *   3. `onWake(...)` fires so the pipeline can emit a
   *      `job.woke_from_sleep` event for post-mortem.
   *
   * Not providing `onWake` leaves the wake detector disarmed. The
   * `wakeSignal` getter still returns a stable never-aborted signal so
   * consumers don't need to branch on detector presence.
   */
  onWake?: (driftMs: number, expectedMs: number, actualMs: number, tick: number) => void;
  /** Drift threshold above which we declare a wake. Defaults to 30_000 (30s). */
  wakeDriftThresholdMs?: number;
  /** Interval at which we sample `Date.now()`. Defaults to 1_000 (1s). */
  wakeCheckMs?: number;
  /**
   * Test-only override for `Date.now`. Production callers leave this
   * undefined so wake detection runs against the real wall clock.
   */
  now?: () => number;
};

/**
 * Deferred wake-signal source. The CLI creates one at startup, hands it to
 * every `createModelForRole` (so their fetch chains can subscribe), and to
 * the `GenerationPipeline` — which at `run()` time attaches the live
 * `Diagnostics.wakeSignal` getter. Until then, `getSignal()` returns a
 * never-aborting stub so model construction works without a pipeline.
 *
 * The indirection matters because models are built at program start (API
 * keys, per-role config) and Diagnostics is created per job (needs jobId
 * for the dump dir). This holder bridges the two lifetimes.
 */
export type WakeSource = {
  /** Called once per fetch by `createWallClockFetch`. Never throws. */
  getSignal: () => AbortSignal;
  /** Pipeline attaches its live Diagnostics after `start()`. */
  attach: (source: () => AbortSignal) => void;
};

export function createWakeSource(): WakeSource {
  // Default: a stable never-aborted signal so pre-pipeline fetches (e.g.
  // the CLI's `git rev-parse` doesn't matter — but model construction
  // itself may not fetch, yet we keep the contract: always return a valid
  // signal) always see a live signal.
  const inert = new AbortController().signal;
  let source: () => AbortSignal = () => inert;
  return {
    getSignal: () => source(),
    attach: (fn) => { source = fn; },
  };
}

export class Diagnostics {
  private timer: NodeJS.Timeout | null = null;
  private wakeTimer: NodeJS.Timeout | null = null;
  private wakeController: AbortController = new AbortController();
  private lastWakeSampleAt = 0;
  private tickCount = 0;
  private sigHandler: NodeJS.SignalsListener | null = null;
  private readonly opts: DiagnosticsOptions;

  constructor(opts: DiagnosticsOptions) {
    this.opts = opts;
  }

  /**
   * Fresh per-wake `AbortSignal`. Read this getter each time a new
   * subscription is needed (e.g. inside `createWallClockFetch` per call)
   * — the controller rotates every time the wake detector fires, so a
   * cached reference would be stale after the first wake event.
   */
  get wakeSignal(): AbortSignal {
    return this.wakeController.signal;
  }

  start(): void {
    const now = this.opts.now ?? (() => Date.now());
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

    if (this.opts.onWake) {
      const wakeCheckMs = this.opts.wakeCheckMs ?? 1_000;
      const threshold = this.opts.wakeDriftThresholdMs ?? 30_000;
      const onWake = this.opts.onWake;
      this.lastWakeSampleAt = now();
      this.wakeTimer = setInterval(() => {
        const actual = now();
        const actualDelta = actual - this.lastWakeSampleAt;
        this.lastWakeSampleAt = actual;
        const drift = actualDelta - wakeCheckMs;
        if (drift > threshold) {
          const old = this.wakeController;
          this.wakeController = new AbortController();
          try {
            old.abort(new Error(`wake-from-sleep: ${drift}ms drift`));
          } catch {
            // abort() throws only if the reason was already set; ignore.
          }
          try { onWake(drift, wakeCheckMs, actualDelta, this.tickCount); } catch { /* best-effort */ }
        }
      }, wakeCheckMs);
      if (typeof this.wakeTimer.unref === "function") this.wakeTimer.unref();
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
    if (this.wakeTimer) {
      clearInterval(this.wakeTimer);
      this.wakeTimer = null;
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
      const hasInfo = typeof (process as { getActiveResourcesInfo?: () => string[] }).getActiveResourcesInfo === "function";
      const info = hasInfo
        ? (process as { getActiveResourcesInfo: () => string[] }).getActiveResourcesInfo()
        : [];
      const counts = info.reduce<Record<string, number>>((acc, name) => {
        acc[name] = (acc[name] ?? 0) + 1;
        return acc;
      }, {});
      const payload: Record<string, unknown> = {
        ts: new Date().toISOString(),
        label: this.opts.label ?? null,
        tick: this.tickCount,
        activeResources: counts,
        memory: process.memoryUsage(),
        uptime: process.uptime(),
      };
      // Surface the missing-API case so readers of the dump don't mistake
      // an empty activeResources for "no active handles" on older Node.
      if (!hasInfo) {
        payload.warning = "process.getActiveResourcesInfo unavailable (Node < 17); activeResources is empty";
      }
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
