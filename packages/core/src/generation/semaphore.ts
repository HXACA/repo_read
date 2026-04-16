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

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
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
