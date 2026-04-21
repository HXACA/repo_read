# Wake-From-Sleep Detector — Design

**Date:** 2026-04-21
**Status:** Approved, implementing

## Problem

Long-running generation jobs (hermes V8 50-page run, repo-read self strict)
wedge for hours when the laptop enters macOS Idle Sleep. Evidence from
`pmset -g log` on 2026-04-21 showed 36 Sleep/Wake cycles overnight with the
Node.js event loop frozen for ~7h18m. On wake, in-flight HTTP streams sit
on TCP connections the remote edge has long since closed
(`CLOSE_WAIT`/`FIN_WAIT_2` in `lsof`), but the application never sees an
error because it was paused alongside the kernel networking.

Our existing mitigations fail in this scenario:

- **`createWallClockFetch` 10-min timeout** — uses `setTimeout`, which
  counts process-runtime ticks, not wall-clock. After a 7-hour sleep, it
  still has ~10 min of runtime left, so it never fires.
- **Stall detector `job.stalled` event** — runs inside the event loop; it
  also pauses during sleep, so it can't catch the hang.
- **SSE inter-chunk timeout** — same `setTimeout` issue.

## Goal

Detect laptop wake-from-sleep and recover the pipeline automatically:

1. Emit an auditable `job.woke_from_sleep` event with drift magnitude.
2. Abort every in-flight fetch so `retryOnTransient` can re-establish
   connections against fresh TCP streams.
3. Keep blast radius small — extend existing modules, don't introduce a
   new lifecycle owner.

## Approach

Extend `Diagnostics` (already owns `setInterval` heartbeat + start/stop
lifecycle + SIGUSR1 dump) with a second `setInterval(1000)` that tracks
`Date.now()` drift. When measured delta exceeds the expected interval by
≥30s, treat it as wake from sleep.

On wake:

1. Call a new `onWake(driftMs, expected, actual)` hook → pipeline emits
   `job.woke_from_sleep`.
2. Abort the internally-held `AbortController` (`wakeController`) → all
   currently-outstanding fetches that subscribed to its signal unstick
   with `AbortError` and throw. Their `finally` blocks release any held
   rate-limiter permits.
3. Replace `wakeController` with a fresh `AbortController` so subsequent
   fetches have a live signal.

`createWallClockFetch` gains an optional `wakeSignal?: AbortSignal` input.
It chains this signal the same way it chains the caller's `init.signal`:
on abort, the per-call `AbortController` fires, bubbling up the abort
through the rate-limiter and into the SDK.

## Drift Threshold

**30s.** Rationale:

- GC pauses and heavy I/O backpressure rarely exceed 5s on production
  Node; 30s has wide safety margin against false positives.
- Shortest observed sleep block in `pmset` is ~45s (DarkWake). Node user
  code doesn't run during DarkWake, so 30s drift is reliably detectable
  when we next get CPU.
- Typical Idle Sleep blocks are 5-17 minutes → drift far exceeds 30s.

## Event Schema

```typescript
type JobWokeFromSleepEvent = {
  type: "job.woke_from_sleep";
  payload: {
    driftMs: number;       // actual - expected
    expectedMs: number;    // setInterval interval (1000)
    actualMs: number;      // measured delta since last tick
    tick: number;          // heartbeat tick at the moment
  };
};
```

## Non-Goals

- **Auto-caffeinate the CLI.** User's machine, user's sleep prefs. We
  document `caffeinate -s` in getting-started, nothing more.
- **Touch rate-limiter internals.** Permit release already happens in the
  fetch's `finally`; fetch abort is sufficient to free them indirectly.
- **Replace the stall detector.** Different failure modes; both valuable.
- **End-to-end "simulate sleep" test.** Too flaky. The 2026-04-21
  pmset timeline stays on file as human verification evidence.

## Files Touched

| File | Change |
|---|---|
| `packages/core/src/utils/diagnostics.ts` | `onWake` callback, `wakeSignal` getter, second `setInterval(1000)` for drift check, internal `wakeController` reset |
| `packages/core/src/utils/resilient-fetch.ts` | `createWallClockFetch` accepts `wakeSignal?: AbortSignal`, chains it into the per-call controller |
| `packages/core/src/utils/__tests__/diagnostics.test.ts` | New: drift-triggers-onWake, controller-rotated-on-wake |
| `packages/core/src/utils/__tests__/resilient-fetch.test.ts` | New: wakeSignal-aborts-fetch test |
| `packages/core/src/generation/generation-pipeline.ts` | Provide `onWake` emitting `job.woke_from_sleep`; thread `wakeSignal` to ProviderCenter fetch wiring |
| `packages/core/src/types/generation.ts` | Add `"job.woke_from_sleep"` to JobEvent union |
| `docs/getting-started.md` | One-line tip: "for long jobs use `caffeinate -s`" |

## Testing Strategy

- **Unit tests only.** Use vitest `useFakeTimers` to advance
  `Date.now()` independently from the fake timer's `advanceTimersByTime()`.
  Simulating a 30s jump under fake timers reliably exercises the drift
  check.
- **No sleep simulation in CI.** The 2026-04-21 pmset log captures the
  real-world failure; this spec is the record of the reproduction.

## Rollout

1. Implement + tests green.
2. Rebuild CLI dist.
3. Kill the two currently-wedged jobs (PID 91232, 80281).
4. Resume both under `caffeinate -s`. If Idle Sleep somehow triggers
   anyway (e.g. lid closed), the new detector must catch it and emit
   `job.woke_from_sleep`.
