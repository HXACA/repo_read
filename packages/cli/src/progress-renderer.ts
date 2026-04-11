/**
 * CLI progress renderer — scrolling log mode.
 *
 * Completed pages print as permanent lines (never erased).
 * Current page uses \r to overwrite a single status line.
 * No multi-line ANSI cursor movement — works in any terminal.
 */

import type { AppEvent } from "@reporead/core";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type PageState = {
  slug: string;
  title: string;
  section?: string;
  status: "pending" | "active" | "done" | "skipped";
  startedAt?: number;
  elapsed?: number;
  attempt: number;
  steps: string[];
  currentPhase?: string;
};

export class ProgressRenderer {
  private pages: PageState[] = [];
  private startedAt = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;
  private resumeSkipped = 0;
  private catalogDone = false;
  /** Track what we've permanently printed so we don't repeat. */
  private printedDoneCount = 0;
  private lastStatusLine = "";

  // ── Public API ────────────────────────────────────────────────

  setPageList(pages: Array<{ slug: string; title: string; section?: string }>): void {
    this.pages = pages.map((p) => ({
      slug: p.slug, title: p.title, section: p.section,
      status: "pending" as const, attempt: 0, steps: [],
    }));
  }

  setResumeSkipped(n: number): void {
    this.resumeSkipped = n;
    for (let i = 0; i < n && i < this.pages.length; i++) {
      this.pages[i].status = "skipped";
    }
  }

  start(): void {
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.renderStatusLine(), 200);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  readonly onEvent = (event: AppEvent): void => {
    this.handleEvent(event);
    // After state change, flush any newly completed pages
    this.flushCompleted();
    this.renderStatusLine();
  };

  printSummary(
    success: boolean,
    job: { versionId: string; id: string; summary: { succeededPages?: number; totalPages?: number } },
  ): void {
    this.stop();
    this.clearStatusLine();
    this.flushCompleted();
    const elapsed = this.fmtDur(Date.now() - this.startedAt);
    const doneTimes = this.pages.filter((p) => p.status === "done" && p.elapsed).map((p) => p.elapsed!);
    const avg = doneTimes.length > 0
      ? this.fmtDur(doneTimes.reduce((a, b) => a + b, 0) / doneTimes.length)
      : "N/A";

    console.log();
    if (success) {
      console.log(`  ${GREEN}✓${RESET} 生成完成!`);
      console.log(`    版本:     ${job.versionId}`);
      console.log(`    页数:     ${job.summary.succeededPages ?? 0}/${job.summary.totalPages ?? 0}`);
      console.log(`    总耗时:   ${elapsed}`);
      console.log(`    平均/页:  ${avg}`);
    } else {
      console.log(`  ✗ 生成失败`);
      console.log(`    任务:   ${job.id}`);
      console.log(`    耗时:   ${elapsed}`);
      console.log(`    续跑:   repo-read generate --resume ${job.id}`);
    }
    console.log();
  }

  // ── Event handling ────────────────────────────────────────────

  private handleEvent(event: AppEvent): void {
    const slug = event.pageSlug ?? "";
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
      case "catalog.completed":
        this.catalogDone = true;
        break;

      case "job.resumed":
        this.catalogDone = true;
        if (this.resumeSkipped > 0) {
          console.log(`  ${DIM}⊘ 1-${this.resumeSkipped} 已完成（上次运行），跳过${RESET}`);
        }
        break;

      case "page.evidence_planned":
        this.activatePage(slug);
        this.pageFor(slug).currentPhase = "收集证据";
        break;

      case "page.evidence_collected": {
        const p = this.pageFor(slug);
        const n = (payload.citationCount as number) ?? 0;
        p.steps.push(`${n}条引用`);
        p.currentPhase = "规划大纲";
        break;
      }

      case "page.drafting": {
        const p = this.activatePage(slug);
        if (p.attempt > 0) {
          p.currentPhase = "重写中";
        } else {
          if (p.steps.length > 0 && !p.steps.some((s) => s.includes("大纲"))) {
            p.steps.push("大纲");
          }
          p.currentPhase = "撰写中";
        }
        break;
      }

      case "page.drafted":
        this.pageFor(slug).currentPhase = "审阅中";
        break;

      case "page.reviewed": {
        const p = this.pageFor(slug);
        if ((payload.verdict as string) === "revise") {
          p.attempt++;
          p.steps.push(`修订#${p.attempt}`);
          p.currentPhase = "重写中";
        } else {
          p.currentPhase = "校验中";
        }
        break;
      }

      case "page.validated": {
        const p = this.pageFor(slug);
        p.status = "done";
        p.elapsed = Date.now() - (p.startedAt ?? Date.now());
        p.currentPhase = undefined;
        break;
      }
    }
  }

  private activatePage(slug: string): PageState {
    const p = this.pageFor(slug);
    if (p.status !== "active") {
      p.status = "active";
      p.startedAt = Date.now();
      p.steps = [];
      p.attempt = 0;
    }
    return p;
  }

  private pageFor(slug: string): PageState {
    return this.pages.find((p) => p.slug === slug) ??
      (() => { const p: PageState = { slug, title: slug, status: "active", startedAt: Date.now(), attempt: 0, steps: [] }; this.pages.push(p); return p; })();
  }

  // ── Output ────────────────────────────────────────────────────

  /** Print any newly-completed pages as permanent log lines. */
  private flushCompleted(): void {
    // Print catalog line once
    if (this.catalogDone && this.printedDoneCount === 0 && this.pages.length > 0) {
      this.clearStatusLine();
      const total = this.pages.length;
      const sections = new Set(this.pages.map((p) => p.section).filter(Boolean)).size;
      console.log(`  ${GREEN}✓${RESET} 目录: ${total} 章${sections > 0 ? ` · ${sections} 节` : ""}`);
    }

    let i = this.resumeSkipped; // start after skipped pages
    let printed = 0;
    for (; i < this.pages.length; i++) {
      const p = this.pages[i];
      if (p.status !== "done") break;
      printed++;
      if (printed <= this.printedDoneCount) continue;
      // New completion — print it
      this.clearStatusLine();
      const num = String(i + 1).padStart(2);
      const elapsed = this.fmtDur(p.elapsed ?? 0);
      const attempts = p.attempt > 0 ? ` (${p.attempt + 1}次)` : "";
      console.log(`  ${GREEN}✓${RESET} ${num}. ${p.title}${attempts}  ${DIM}${elapsed}${RESET}`);
    }
    this.printedDoneCount = printed;
  }

  /** Overwrite the single status line with current page info + progress. */
  private renderStatusLine(): void {
    this.tick++;
    const s = SPINNER[this.tick % SPINNER.length];
    const doneCount = this.resumeSkipped + this.pages.filter((p) => p.status === "done").length;
    const total = this.pages.length || "?";
    const elapsed = this.fmtDur(Date.now() - this.startedAt);

    const active = this.pages.find((p) => p.status === "active");
    let line: string;

    if (!this.catalogDone) {
      line = `  ${s} 正在分析仓库结构... ${DIM}${elapsed}${RESET}`;
    } else if (active) {
      const num = this.pages.indexOf(active) + 1;
      const phase = active.currentPhase ?? "准备中";
      const chain = active.steps.length > 0 ? ` ${DIM}${active.steps.join(" → ")}${RESET}` : "";
      const pageElapsed = this.fmtDur(Date.now() - (active.startedAt ?? Date.now()));
      line = `  ${YELLOW}${s}${RESET} ${num}/${total} ${active.title} ${DIM}[${phase}]${RESET}${chain} ${DIM}${pageElapsed}${RESET}  ${DIM}总${elapsed}${RESET}`;
    } else {
      line = `  ${DIM}${doneCount}/${total} ${elapsed}${RESET}`;
    }

    // Use \r to overwrite in place. Pad with spaces to clear previous longer line.
    const tw = process.stderr.columns || 120;
    const padded = line.length < tw ? line + " ".repeat(Math.max(0, tw - this.visLen(line))) : line;
    process.stderr.write(`\r${padded}`);
    this.lastStatusLine = line;
  }

  private clearStatusLine(): void {
    if (this.lastStatusLine) {
      const tw = process.stderr.columns || 120;
      process.stderr.write(`\r${" ".repeat(tw)}\r`);
      this.lastStatusLine = "";
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  private visLen(s: string): number {
    return s.replace(/\x1b\[[0-9;]*m/g, "").length;
  }

  private fmtDur(ms: number): string {
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    if (min < 60) return s > 0 ? `${min}m${s}s` : `${min}m`;
    const hr = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${hr}h${m}m` : `${hr}h`;
  }
}
