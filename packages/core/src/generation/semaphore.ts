import { signalAbortReason } from "../utils/abort.js";

/**
 * Counting semaphore with a FIFO wait queue.
 *
 * - `acquire()` resolves immediately if a permit is available, otherwise
 *   queues and resolves when some other caller releases.
 * - `release()` hands a permit to the next waiter (if any) before
 *   returning permits to the pool. This preserves FIFO fairness.
 */
export class Semaphore {
  private permits: number;
  private readonly queue: Array<() => void> = [];

  constructor(count: number) {
    if (count < 1) {
      throw new Error(`Semaphore count must be >= 1, got ${count}`);
    }
    this.permits = count;
  }

  /**
   * Acquire a permit, optionally abortable via AbortSignal. When the signal
   * fires before the permit is handed over, the waiter is dequeued and the
   * returned promise rejects — important so wall-clock timeouts can unstick
   * waiters when permits leak or upstream calls hang.
   */
  async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw signalAbortReason(signal);
    }
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const waiter = () => {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        const idx = this.queue.indexOf(waiter);
        if (idx >= 0) this.queue.splice(idx, 1);
        reject(signalAbortReason(signal!));
      };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      this.queue.push(waiter);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

