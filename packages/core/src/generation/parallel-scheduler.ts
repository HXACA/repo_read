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
    // Out-of-order in, in-order out. At pageConcurrency > 1 pages finish in
    // completion order, but publishedSummaries + the persisted
    // published-index.json must match the wiki's reading_order so downstream
    // evidence / review prompts reference the right neighbors. We collect
    // into indexed slots and drain the leading in-order prefix each time a
    // new page completes. Semantically a page is only "published" once its
    // predecessor has also published — matches the reading-order invariant.
    const summarySlots: Array<PublishedSummary | undefined> = new Array(pages.length);
    const failedSlots: boolean[] = new Array(pages.length).fill(false);
    let nextToPublish = 0;

    const drainConsecutive = () => {
      while (nextToPublish < pages.length) {
        if (summarySlots[nextToPublish]) {
          publishedSummaries.push(summarySlots[nextToPublish]!);
          nextToPublish++;
          continue;
        }
        if (failedSlots[nextToPublish]) {
          // Skip failed pages — their gate still resolves, but they have
          // no summary to publish. Advance the pointer so later successful
          // pages can drain through.
          nextToPublish++;
          continue;
        }
        break;
      }
    };

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
            summarySlots[i] = result.summary;
          } else {
            failedSlots[i] = true;
          }
          results[i] = result;
          drainConsecutive();
        } finally {
          gates[i].resolve(); // ALWAYS resolve — even on failure
          semaphore.release();
        }
      }),
    );

    // Final drain catches any trailing slots the in-flight drains missed
    // (can happen if the last page in reading order was also the last to
    // finish, depending on timing).
    drainConsecutive();

    return results;
  }
}
