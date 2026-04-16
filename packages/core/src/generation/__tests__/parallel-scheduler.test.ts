import { describe, it, expect, vi } from "vitest";
import {
  ParallelPageScheduler,
  createGate,
  type PageRunResult,
} from "../parallel-scheduler.js";

type TestPage = { slug: string; title: string };

function mockPages(n: number): TestPage[] {
  return Array.from({ length: n }, (_, i) => ({
    slug: `page-${i}`,
    title: `Page ${i}`,
  }));
}

describe("createGate", () => {
  it("returns a resolvable promise", async () => {
    const gate = createGate();
    let resolved = false;
    gate.promise.then(() => { resolved = true; });
    await new Promise((r) => setImmediate(r));
    expect(resolved).toBe(false);
    gate.resolve();
    await gate.promise;
    expect(resolved).toBe(true);
  });
});

describe("ParallelPageScheduler", () => {
  it("throws on concurrency < 1", () => {
    expect(() => new ParallelPageScheduler({ concurrency: 0, runPage: vi.fn() })).toThrow();
  });

  it("runs zero pages without error", async () => {
    const scheduler = new ParallelPageScheduler<TestPage>({
      concurrency: 3,
      runPage: vi.fn(),
    });
    const results = await scheduler.runAll([], []);
    expect(results).toEqual([]);
  });

  it("concurrency=1 behaves sequentially and preserves summary order", async () => {
    const runPage = vi.fn(
      async (ctx: { page: TestPage; pageIndex: number; reviewGate: Promise<void> }): Promise<PageRunResult> => {
        await ctx.reviewGate;
        return {
          success: true,
          summary: { slug: ctx.page.slug, title: ctx.page.title, summary: "s" },
        };
      },
    );
    const scheduler = new ParallelPageScheduler<TestPage>({ concurrency: 1, runPage });
    const pages = mockPages(3);
    const summaries: Array<{ slug: string; title: string; summary: string }> = [];
    const results = await scheduler.runAll(pages, summaries);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(summaries.map((s) => s.slug)).toEqual(["page-0", "page-1", "page-2"]);
  });

  it("concurrency=3 runs up to 3 pages in parallel and enforces gate order", async () => {
    const startOrder: string[] = [];
    const endOrder: string[] = [];
    const releaseMap = new Map<string, () => void>();

    const runPage = vi.fn(
      async (ctx: { page: TestPage; reviewGate: Promise<void> }): Promise<PageRunResult> => {
        startOrder.push(ctx.page.slug);
        await new Promise<void>((resolve) => releaseMap.set(ctx.page.slug, resolve));
        await ctx.reviewGate;
        endOrder.push(ctx.page.slug);
        return {
          success: true,
          summary: { slug: ctx.page.slug, title: ctx.page.title, summary: "s" },
        };
      },
    );
    const scheduler = new ParallelPageScheduler<TestPage>({ concurrency: 3, runPage });
    const pages = mockPages(5);
    const summaries: Array<{ slug: string; title: string; summary: string }> = [];
    const runPromise = scheduler.runAll(pages, summaries);

    // Wait until 3 pages are running (concurrency limit)
    while (startOrder.length < 3) await new Promise((r) => setImmediate(r));
    expect(startOrder.slice(0, 3)).toEqual(["page-0", "page-1", "page-2"]);
    expect(endOrder).toEqual([]);

    // Release page-0 — it should finish, and page-3 should start.
    releaseMap.get("page-0")!();
    while (startOrder.length < 4) await new Promise((r) => setImmediate(r));
    expect(endOrder).toContain("page-0");
    expect(startOrder).toContain("page-3");

    // Drain remaining pages: release any registered slug until runPromise settles
    let done = false;
    const results = await Promise.race([
      runPromise.then((r) => { done = true; return r; }),
      (async () => {
        while (!done) {
          for (const [slug, release] of releaseMap) {
            release();
            releaseMap.delete(slug);
          }
          await new Promise((r) => setImmediate(r));
        }
        return [] as PageRunResult[];
      })(),
    ]);

    expect(results).toHaveLength(5);
    expect(summaries.map((s) => s.slug)).toEqual([
      "page-0", "page-1", "page-2", "page-3", "page-4",
    ]);
  });

  it("failed page still resolves its gate so later pages proceed", async () => {
    const runPage = vi.fn(
      async (ctx: { page: TestPage; pageIndex: number; reviewGate: Promise<void> }): Promise<PageRunResult> => {
        await ctx.reviewGate;
        if (ctx.page.slug === "page-1") {
          return { success: false, error: "boom" };
        }
        return {
          success: true,
          summary: { slug: ctx.page.slug, title: ctx.page.title, summary: "s" },
        };
      },
    );
    const scheduler = new ParallelPageScheduler<TestPage>({ concurrency: 2, runPage });
    const pages = mockPages(3);
    const summaries: Array<{ slug: string; title: string; summary: string }> = [];
    const results = await scheduler.runAll(pages, summaries);

    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[2].success).toBe(true);
    expect(summaries.map((s) => s.slug)).toEqual(["page-0", "page-2"]);
  });

  it("thrown error in runPage is captured as failure, not propagated", async () => {
    const runPage = vi.fn(async (ctx: { page: TestPage; reviewGate: Promise<void> }) => {
      await ctx.reviewGate;
      if (ctx.page.slug === "page-1") throw new Error("crash");
      return {
        success: true,
        summary: { slug: ctx.page.slug, title: ctx.page.title, summary: "s" },
      } as PageRunResult;
    });
    const scheduler = new ParallelPageScheduler<TestPage>({ concurrency: 2, runPage });
    const results = await scheduler.runAll(mockPages(3), []);
    expect(results[1].success).toBe(false);
    expect(results[1].error).toContain("crash");
    expect(results[0].success).toBe(true);
    expect(results[2].success).toBe(true);
  });
});
