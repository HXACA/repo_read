import { describe, it, expect } from "vitest";
import { Semaphore } from "../semaphore.js";

describe("Semaphore", () => {
  it("throws when count < 1", () => {
    expect(() => new Semaphore(0)).toThrow();
    expect(() => new Semaphore(-1)).toThrow();
  });

  it("allows immediate acquire up to capacity", async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();
    // third acquire would block; verify with a race
    let acquired = false;
    const pending = sem.acquire().then(() => { acquired = true; });
    // Give microtasks a chance
    await new Promise((r) => setImmediate(r));
    expect(acquired).toBe(false);
    sem.release();
    await pending;
    expect(acquired).toBe(true);
  });

  it("release wakes waiters in FIFO order", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    const events: number[] = [];
    const p1 = sem.acquire().then(() => events.push(1));
    const p2 = sem.acquire().then(() => events.push(2));
    sem.release();
    await p1;
    sem.release();
    await p2;
    expect(events).toEqual([1, 2]);
  });

  it("release when no waiters increments available permits", async () => {
    const sem = new Semaphore(1);
    sem.release();       // permits = 2
    await sem.acquire(); // permits = 1
    await sem.acquire(); // permits = 0
    let acquired = false;
    sem.acquire().then(() => { acquired = true; });
    await new Promise((r) => setImmediate(r));
    expect(acquired).toBe(false);
  });

  it("rejects a waiter when its abort signal fires", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    const ctrl = new AbortController();
    const pending = sem.acquire(ctrl.signal);
    await new Promise((r) => setImmediate(r));
    ctrl.abort(new Error("wall-clock"));
    await expect(pending).rejects.toThrow("wall-clock");
  });

  it("rejects immediately when signal is already aborted", async () => {
    const sem = new Semaphore(1);
    const ctrl = new AbortController();
    ctrl.abort(new Error("pre-aborted"));
    await expect(sem.acquire(ctrl.signal)).rejects.toThrow("pre-aborted");
  });

  it("removes aborted waiter from queue so subsequent releases reach live waiters", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    const doomed = new AbortController();
    const p1 = sem.acquire(doomed.signal).catch(() => "aborted");
    const p2 = sem.acquire();
    doomed.abort(new Error("gone"));
    await expect(p1).resolves.toBe("aborted");
    sem.release();
    await expect(Promise.race([
      p2.then(() => "got it"),
      new Promise((_, rej) => setTimeout(() => rej(new Error("live waiter blocked")), 100)),
    ])).resolves.toBe("got it");
  });
});
