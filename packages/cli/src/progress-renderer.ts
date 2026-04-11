/**
 * CLI progress panel for `repo-read generate`.
 *
 * Zread-style full chapter list with spinner, Chinese status labels,
 * and real-time sub-step chain. Refreshed every 100ms via ANSI escape.
 *
 * See docs/superpowers/specs/2026-04-11-cli-progress-panel-design.md
 */

import type { AppEvent } from "@reporead/core";

// ── ANSI ──────────────────────────────────────────────────────────
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const UP = "\x1b[A";
const CLEAR_LINE = "\x1b[2K";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// ── Types ─────────────────────────────────────────────────────────

type PageDisplayState = {
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

// ── Renderer ──────────────────────────────────────────────────────

export class ProgressRenderer {
  private pages: PageDisplayState[] = [];
  private startedAt = Date.now();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastLineCount = 0;
  private resumeSkipped = 0;
  private catalogDone = false;
  private sectionCount = 0;
  private tick = 0;

  // ── Public API ────────────────────────────────────────────────

  setPageList(
    pages: Array<{ slug: string; title: string; section?: string }>,
  ): void {
    this.pages = pages.map((p) => ({
      slug: p.slug,
      title: p.title,
      section: p.section,
      status: "pending" as const,
      attempt: 0,
      steps: [],
    }));
    const sections = new Set(pages.map((p) => p.section).filter(Boolean));
    this.sectionCount = sections.size;
  }

  setResumeSkipped(n: number): void {
    this.resumeSkipped = n;
    for (let i = 0; i < n && i < this.pages.length; i++) {
      this.pages[i].status = "skipped";
    }
  }

  start(): void {
    this.startedAt = Date.now();
    this.refreshTimer = setInterval(() => this.render(), 100);
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  readonly onEvent = (event: AppEvent): void => {
    this.handleEvent(event);
  };

  printSummary(
    success: boolean,
    job: {
      versionId: string;
      id: string;
      summary: { succeededPages?: number; totalPages?: number };
    },
  ): void {
    this.stop();
    this.clearLines();
    const elapsed = this.fmtDur(Date.now() - this.startedAt);
    const doneTimes = this.pages
      .filter((p) => p.status === "done" && p.elapsed)
      .map((p) => p.elapsed!);
    const avg =
      doneTimes.length > 0
        ? this.fmtDur(doneTimes.reduce((a, b) => a + b, 0) / doneTimes.length)
        : "N/A";

    if (success) {
      console.log(`\n  ${GREEN}✓${RESET} 生成完成!`);
      console.log(`    版本:     ${job.versionId}`);
      console.log(
        `    页数:     ${job.summary.succeededPages ?? 0}/${job.summary.totalPages ?? 0}`,
      );
      console.log(`    总耗时:   ${elapsed}`);
      console.log(`    平均/页:  ${avg}`);
    } else {
      console.log(`\n  ✗ 生成失败`);
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
      case "catalog.completed": {
        const total = (payload.totalPages as number) ?? 0;
        this.catalogDone = true;
        // If pages weren't set yet (fresh gen), we'll get them from generate.tsx
        if (this.pages.length === 0) {
          // Placeholder — generate.tsx will call setPageList right after
        }
        break;
      }

      case "job.resumed":
        this.catalogDone = true;
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
          p.currentPhase = "撰写中";
        } else if (p.steps.length > 0) {
          if (!p.steps.some((s) => s.includes("大纲"))) {
            p.steps.push("大纲");
          }
          p.currentPhase = "撰写中";
        } else {
          p.currentPhase = "撰写中";
        }
        break;
      }

      case "page.drafted": {
        const p = this.pageFor(slug);
        p.currentPhase = "审阅中";
        break;
      }

      case "page.reviewed": {
        const p = this.pageFor(slug);
        const verdict = payload.verdict as string;
        if (verdict === "revise") {
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

  private activatePage(slug: string): PageDisplayState {
    const p = this.pageFor(slug);
    if (p.status !== "active") {
      p.status = "active";
      p.startedAt = Date.now();
      p.steps = [];
      p.attempt = 0;
    }
    return p;
  }

  private pageFor(slug: string): PageDisplayState {
    const found = this.pages.find((p) => p.slug === slug);
    if (found) return found;
    const p: PageDisplayState = {
      slug,
      title: slug,
      status: "active",
      startedAt: Date.now(),
      attempt: 0,
      steps: [],
    };
    this.pages.push(p);
    return p;
  }

  // ── Rendering ─────────────────────────────────────────────────

  private render(): void {
    this.tick++;
    const lines: string[] = [];
    const tw = process.stderr.columns || 100;
    const spinner = SPINNER[this.tick % SPINNER.length];

    const doneCount = this.pages.filter(
      (p) => p.status === "done" || p.status === "skipped",
    ).length;
    const activeIdx = this.pages.findIndex((p) => p.status === "active");

    // ── Header ──
    if (this.catalogDone && this.pages.length > 0) {
      const hdr = `── 目录 · ${this.pages.length} 章 · ${this.sectionCount || "?"}节 `;
      lines.push(`${DIM}${hdr}${"─".repeat(Math.max(0, tw - hdr.length))}${RESET}`);

      // Catalog status
      const catTag = `${DIM}[完成]${RESET}`;
      const catLine = `  ${GREEN}✓${RESET} 目录规划`;
      lines.push(`${catLine}${this.gap(catLine, catTag, tw)}${catTag}`);
    } else {
      const hdr = `── 目录 `;
      lines.push(`${DIM}${hdr}${"─".repeat(Math.max(0, tw - hdr.length))}${RESET}`);
      const catLine = `  ${spinner} 正在分析仓库结构...`;
      lines.push(catLine);
    }

    // ── Active section header ──
    if (activeIdx >= 0) {
      const pageNum = activeIdx + 1;
      const total = this.pages.length;
      const secHdr = `── 文章 ${pageNum}/${total} `;
      lines.push(`${DIM}${secHdr}${"─".repeat(Math.max(0, tw - secHdr.length))}${RESET}`);
    } else if (doneCount === this.pages.length && this.pages.length > 0) {
      const secHdr = `── 全部完成 `;
      lines.push(`${DIM}${secHdr}${"─".repeat(Math.max(0, tw - secHdr.length))}${RESET}`);
    }

    // ── Skip line ──
    if (this.resumeSkipped > 0) {
      lines.push(
        `  ${DIM}⊘ 1-${this.resumeSkipped} 已完成（上次运行），跳过${RESET}`,
      );
    }

    // ── Chapter list ──
    let lastSection = "";
    for (let i = 0; i < this.pages.length; i++) {
      const p = this.pages[i];
      if (p.status === "skipped") continue;

      // Section divider
      if (p.section && p.section !== lastSection) {
        lastSection = p.section;
        const label = ` ${p.section} `;
        const pad = Math.max(0, tw - 4 - label.length);
        lines.push(`${DIM}── ${label}${"─".repeat(pad)}${RESET}`);
      }

      const num = String(i + 1).padStart(2);

      switch (p.status) {
        case "done": {
          const elapsed = this.fmtDur(p.elapsed ?? 0);
          const attempts = p.attempt > 0 ? ` (${p.attempt + 1}次)` : "";
          const tag = `${DIM}[完成] ${elapsed}${RESET}`;
          const line = `  ${GREEN}✓${RESET} ${num}. ${p.title}${attempts}`;
          lines.push(`${line}${this.gap(line, tag, tw)}${tag}`);
          break;
        }
        case "active": {
          const elapsed = this.fmtDur(Date.now() - (p.startedAt ?? Date.now()));
          const phase = p.currentPhase ?? "准备中";
          const tag = `${YELLOW}[${phase}]${RESET} ${DIM}${elapsed}${RESET}`;
          const line = `${YELLOW}> ${spinner}${RESET} ${num}. ${p.title}`;
          lines.push(`${line}${this.gap(line, tag, tw)}${tag}`);
          // Sub-step chain
          if (p.steps.length > 0) {
            lines.push(`${DIM}       ${p.steps.join(" → ")}${RESET}`);
          }
          break;
        }
        case "pending": {
          const tag = `${DIM}[等待]${RESET}`;
          const line = `  ${DIM}○ ${num}. ${p.title}${RESET}`;
          lines.push(`${line}${this.gap(line, tag, tw)}${tag}`);
          break;
        }
      }
    }

    // ── Progress bar ──
    if (this.pages.length > 0) {
      const total = this.pages.length;
      const pct = Math.round((doneCount / total) * 100);
      const barW = 20;
      const filled = Math.round((doneCount / total) * barW);
      const bar = "▓".repeat(filled) + "░".repeat(barW - filled);
      const elapsed = this.fmtDur(Date.now() - this.startedAt);
      let eta = "";
      const doneTimes = this.pages
        .filter((p) => p.status === "done" && p.elapsed)
        .map((p) => p.elapsed!);
      if (doneTimes.length > 0) {
        const avgMs = doneTimes.reduce((a, b) => a + b, 0) / doneTimes.length;
        const remaining = total - doneCount;
        eta = ` · 预计 ~${this.fmtDur(remaining * avgMs)}`;
      }
      lines.push("");
      lines.push(
        `  ${bar} ${doneCount}/${total} ${pct}% · ${elapsed}${eta}`,
      );
    }

    // ── Write ──
    this.clearLines();
    const output = lines.join("\n") + "\n";
    process.stderr.write(output);
    this.lastLineCount = lines.length;
  }

  // ── Helpers ───────────────────────────────────────────────────

  private clearLines(): void {
    for (let i = 0; i < this.lastLineCount; i++) {
      process.stderr.write(UP + CLEAR_LINE);
    }
    this.lastLineCount = 0;
  }

  /** Calculate gap spaces to right-align `tag` in terminal width. */
  private gap(left: string, right: string, tw: number): string {
    const lLen = this.visLen(left);
    const rLen = this.visLen(right);
    return " ".repeat(Math.max(1, tw - lLen - rLen - 1));
  }

  /** Visible string length (strips ANSI escape codes). */
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
