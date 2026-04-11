/**
 * CLI progress panel — full chapter list with in-place refresh.
 *
 * Uses save/restore cursor + clear-to-end-of-screen for redraws.
 * Falls back to scrolling log if pages aren't available yet.
 */

import type { AppEvent } from "@reporead/core";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const SAVE_CURSOR = "\x1b[s";
const RESTORE_AND_CLEAR = "\x1b[u\x1b[J";
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
  private cursorSaved = false;

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
    // Save cursor position — all future renders restore to this point
    process.stderr.write(SAVE_CURSOR);
    this.cursorSaved = true;
    this.timer = setInterval(() => this.render(), 250);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  readonly onEvent = (event: AppEvent): void => {
    this.handleEvent(event);
    this.render();
  };

  printSummary(
    success: boolean,
    job: { versionId: string; id: string; summary: { succeededPages?: number; totalPages?: number } },
  ): void {
    this.stop();
    // Final render then move past it
    this.render();
    // Write summary below the panel
    process.stderr.write("\n");
    const elapsed = this.fmtDur(Date.now() - this.startedAt);
    const doneTimes = this.pages.filter((p) => p.status === "done" && p.elapsed).map((p) => p.elapsed!);
    const avg = doneTimes.length > 0
      ? this.fmtDur(doneTimes.reduce((a, b) => a + b, 0) / doneTimes.length)
      : "N/A";

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

  // ── Events ────────────────────────────────────────────────────

  private handleEvent(event: AppEvent): void {
    const slug = event.pageSlug ?? "";
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
      case "catalog.completed":
        this.catalogDone = true;
        break;
      case "job.resumed":
        this.catalogDone = true;
        break;
      case "page.evidence_planned":
        this.activate(slug).currentPhase = "收集证据";
        break;
      case "page.evidence_collected": {
        const p = this.pageFor(slug);
        p.steps.push(`${(payload.citationCount as number) ?? 0}条引用`);
        p.currentPhase = "规划大纲";
        break;
      }
      case "page.drafting": {
        const p = this.activate(slug);
        if (p.attempt > 0) { p.currentPhase = "重写中"; }
        else {
          if (p.steps.length > 0 && !p.steps.some((s) => s.includes("大纲")))
            p.steps.push("大纲");
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
        } else { p.currentPhase = "校验中"; }
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

  private activate(slug: string): PageState {
    const p = this.pageFor(slug);
    if (p.status !== "active") {
      p.status = "active"; p.startedAt = Date.now(); p.steps = []; p.attempt = 0;
    }
    return p;
  }

  private pageFor(slug: string): PageState {
    return this.pages.find((p) => p.slug === slug) ??
      (() => { const p: PageState = { slug, title: slug, status: "active", startedAt: Date.now(), attempt: 0, steps: [] }; this.pages.push(p); return p; })();
  }

  // ── Render ────────────────────────────────────────────────────

  private render(): void {
    this.tick++;
    const s = SPINNER[this.tick % SPINNER.length];
    const tw = process.stderr.columns || 100;
    const elapsed = this.fmtDur(Date.now() - this.startedAt);
    const lines: string[] = [];

    if (this.pages.length === 0) {
      // Catalog phase — minimal display
      lines.push(`  ${s} 正在分析仓库结构... ${DIM}${elapsed}${RESET}`);
    } else {
      // Full panel
      const total = this.pages.length;
      const doneCount = this.pages.filter((p) => p.status === "done" || p.status === "skipped").length;
      const sections = new Set(this.pages.map((p) => p.section).filter(Boolean)).size;

      // Header
      const hdr = `── 目录 · ${total} 章${sections > 0 ? ` · ${sections} 节` : ""} `;
      lines.push(`${DIM}${hdr}${"─".repeat(Math.max(0, tw - this.visLen(hdr)))}${RESET}`);

      // Catalog status
      if (this.catalogDone) {
        lines.push(this.fmtLine(`  ${GREEN}✓${RESET} 目录规划`, `${DIM}[完成]${RESET}`, tw));
      }

      // Skip line
      if (this.resumeSkipped > 0) {
        lines.push(`  ${DIM}⊘ 1-${this.resumeSkipped} 已完成（上次运行），跳过${RESET}`);
      }

      // Active section header
      const activeIdx = this.pages.findIndex((p) => p.status === "active");
      if (activeIdx >= 0) {
        const secHdr = `── 文章 ${activeIdx + 1}/${total} `;
        lines.push(`${DIM}${secHdr}${"─".repeat(Math.max(0, tw - this.visLen(secHdr)))}${RESET}`);
      }

      // Pages
      let lastSec = "";
      for (let i = 0; i < this.pages.length; i++) {
        const p = this.pages[i];
        if (p.status === "skipped") continue;

        // Section divider
        if (p.section && p.section !== lastSec) {
          lastSec = p.section;
          lines.push(`${DIM}  ┈ ${p.section} ┈${RESET}`);
        }

        const num = String(i + 1).padStart(2);
        switch (p.status) {
          case "done": {
            const el = this.fmtDur(p.elapsed ?? 0);
            const att = p.attempt > 0 ? ` (${p.attempt + 1}次)` : "";
            lines.push(this.fmtLine(
              `  ${GREEN}✓${RESET} ${num}. ${p.title}${att}`,
              `${DIM}[完成] ${el}${RESET}`, tw,
            ));
            break;
          }
          case "active": {
            const el = this.fmtDur(Date.now() - (p.startedAt ?? Date.now()));
            const phase = p.currentPhase ?? "准备中";
            lines.push(this.fmtLine(
              `${YELLOW}> ${s}${RESET} ${num}. ${p.title}`,
              `${YELLOW}[${phase}]${RESET} ${DIM}${el}${RESET}`, tw,
            ));
            if (p.steps.length > 0) {
              lines.push(`${DIM}       ${p.steps.join(" → ")}${RESET}`);
            }
            break;
          }
          case "pending": {
            lines.push(this.fmtLine(
              `  ${DIM}○ ${num}. ${p.title}${RESET}`,
              `${DIM}[等待]${RESET}`, tw,
            ));
            break;
          }
        }
      }

      // Progress bar
      const pct = Math.round((doneCount / total) * 100);
      const barW = 20;
      const filled = Math.round((doneCount / total) * barW);
      const bar = "▓".repeat(filled) + "░".repeat(barW - filled);
      let eta = "";
      const doneTimes = this.pages.filter((p) => p.status === "done" && p.elapsed).map((p) => p.elapsed!);
      if (doneTimes.length > 0) {
        const avgMs = doneTimes.reduce((a, b) => a + b, 0) / doneTimes.length;
        eta = ` · 预计 ~${this.fmtDur((total - doneCount) * avgMs)}`;
      }
      lines.push("");
      lines.push(`  ${bar} ${doneCount}/${total} ${pct}% · ${elapsed}${eta}`);
    }

    // Write: restore cursor to saved position, clear everything below, then write
    if (this.cursorSaved) {
      process.stderr.write(RESTORE_AND_CLEAR);
    }
    process.stderr.write(lines.join("\n") + "\n");
  }

  // ── Helpers ───────────────────────────────────────────────────

  private fmtLine(left: string, right: string, tw: number): string {
    const gap = Math.max(1, tw - this.visLen(left) - this.visLen(right) - 1);
    return `${left}${" ".repeat(gap)}${right}`;
  }

  private visLen(s: string): number {
    return s.replace(/\x1b\[[0-9;]*m/g, "").length;
  }

  private fmtDur(ms: number): string {
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const sv = sec % 60;
    if (min < 60) return sv > 0 ? `${min}m${sv}s` : `${min}m`;
    const hr = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${hr}h${m}m` : `${hr}h`;
  }
}
