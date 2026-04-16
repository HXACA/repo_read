import { Semaphore } from "./semaphore.js";

export type PublishedSummary = { slug: string; title: string; summary: string };

export type PageGate = {
  promise: Promise<void>;
  resolve: () => void;
};

/** Create a promise/resolver pair used to signal "previous page is safe to consume". */
export function createGate(): PageGate {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

export type PageRunResult = {
  success: boolean;
  summary?: PublishedSummary;
  error?: string;
  // The pipeline attaches full throughput records; the scheduler is agnostic.
  // Use a wide index signature so the scheduler does not depend on the
  // pipeline-specific record shape.
  [key: string]: unknown;
};

export type PageRunContext<Page> = {
  page: Page;
  pageIndex: number;
  reviewGate: Promise<void>;
  onFirstReviewStart?: () => void;
};

export type ParallelSchedulerOptions<Page> = {
  concurrency: number;
  runPage: (ctx: PageRunContext<Page>) => Promise<PageRunResult>;
};

/**
 * Sliding-window scheduler for page workflows.
 *
 * Contract:
 * - Dispatches up to `concurrency` pages concurrently.
 * - Each page receives a `reviewGate` that must be awaited before the first
 *   review. Gate N resolves when page N-1 has finished (success or failure) —
 *   guaranteeing `publishedSummaries` is up-to-date when review begins.
 * - Failures are captured in `PageRunResult.success=false`; the scheduler
 *   never re-throws so a single page failure does not poison the batch.
 * - Summaries are appended to the shared `publishedSummaries` array in
 *   reading order once each page validates successfully.
 */
export class ParallelPageScheduler<Page> {
  constructor(private readonly opts: ParallelSchedulerOptions<Page>) {
    if (opts.concurrency < 1) {
      throw new Error(`concurrency must be >= 1, got ${opts.concurrency}`);
    }
  }

  async runAll(
    pages: readonly Page[],
    publishedSummaries: PublishedSummary[],
  ): Promise<PageRunResult[]> {
    if (pages.length === 0) return [];

    const { concurrency, runPage } = this.opts;
    const gates = pages.map(() => createGate());
    const semaphore = new Semaphore(concurrency);
    const results: PageRunResult[] = new Array(pages.length);

    await Promise.all(
      pages.map(async (page, i) => {
        await semaphore.acquire();
        try {
          const reviewGate = i > 0 ? gates[i - 1].promise : Promise.resolve();
          let result: PageRunResult;
          try {
            result = await runPage({
              page,
              pageIndex: i,
              reviewGate,
            });
          } catch (err) {
            result = {
              success: false,
              error: (err as Error).message ?? String(err),
            };
          }
          if (result.success && result.summary) {
            publishedSummaries.push(result.summary);
          }
          results[i] = result;
        } finally {
          gates[i].resolve(); // ALWAYS resolve — even on failure
          semaphore.release();
        }
      }),
    );

    return results;
  }
}
