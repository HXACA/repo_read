/**
 * CLI progress panel — in-place refresh.
 *
 * Uses cursor-up + clear-to-end-of-screen (\x1b[J) instead of
 * line-by-line clearing. This is robust against line wrapping,
 * terminal resize, and line count mismatches.
 *
 * All chapters are always shown — no truncation, no sliding window.
 */

import type { AppEvent } from "@reporead/core";

const D = "\x1b[2m";  // dim
const R = "\x1b[0m";  // reset
const G = "\x1b[32m"; // green
const Y = "\x1b[33m"; // yellow
const C = "\x1b[36m"; // cyan
const SP = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type Page = {
  slug: string; title: string; section?: string;
  status: "pending" | "active" | "done" | "skipped";
  startedAt?: number; elapsed?: number; attempt: number;
  steps: string[]; phase?: string;
};

export class ProgressRenderer {
  private pages: Page[] = [];
  private started = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;
  private skipN = 0;
  private catalogDone = false;
  private liveLines = 0;

  setPageList(p: Array<{ slug: string; title: string; section?: string }>) {
    this.pages = p.map((x) => ({
      slug: x.slug, title: x.title, section: x.section,
      status: "pending" as const, attempt: 0, steps: [],
    }));
  }

  setResumeSkipped(n: number) {
    this.skipN = n;
    for (let i = 0; i < n && i < this.pages.length; i++) this.pages[i].status = "skipped";
  }

  start() {
    this.started = Date.now();
    this.timer = setInterval(() => this.render(), 500);
  }

  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  readonly onEvent = (e: AppEvent) => {
    this.handle(e);
    this.render();
  };

  printSummary(ok: boolean, job: { versionId: string; id: string; summary: { succeededPages?: number; totalPages?: number } }) {
    this.stop();
    this.eraseLive();
    const el = this.dur(Date.now() - this.started);
    const ts = this.pages.filter((p) => p.status === "done" && p.elapsed).map((p) => p.elapsed!);
    const avg = ts.length ? this.dur(ts.reduce((a, b) => a + b, 0) / ts.length) : "N/A";
    console.log();
    if (ok) {
      console.log(`  ${G}✓${R} 生成完成!  版本: ${job.versionId}  页数: ${job.summary.succeededPages ?? 0}/${job.summary.totalPages ?? 0}  耗时: ${el}  平均: ${avg}`);
    } else {
      console.log(`  ✗ 生成失败  任务: ${job.id}  耗时: ${el}`);
      console.log(`    续跑: repo-read generate --resume ${job.id}`);
    }
    console.log();
  }

  private handle(e: AppEvent) {
    const s = e.pageSlug ?? "";
    const p = e.payload as Record<string, unknown>;
    switch (e.type) {
      case "catalog.completed":
      case "job.resumed":
        this.catalogDone = true;
        break;
      case "page.evidence_planned": this.act(s).phase = "收集证据"; break;
      case "page.evidence_collected": { const pg = this.pg(s); pg.steps.push(`${(p.citationCount as number) ?? 0}条引用`); pg.phase = "规划大纲"; break; }
      case "page.drafting": { const pg = this.act(s); pg.phase = pg.attempt > 0 ? "重写中" : "撰写中"; if (pg.attempt === 0 && pg.steps.length && !pg.steps.some((x) => x.includes("大纲"))) pg.steps.push("大纲"); break; }
      case "page.drafted": this.pg(s).phase = "审阅中"; break;
      case "page.reviewed": { const pg = this.pg(s); if ((p.verdict as string) === "revise") { pg.attempt++; pg.steps.push(`修订#${pg.attempt}`); pg.phase = "重写中"; } else pg.phase = "校验中"; break; }
      case "page.validated": { const pg = this.pg(s); pg.status = "done"; pg.elapsed = Date.now() - (pg.startedAt ?? Date.now()); pg.phase = undefined; break; }
    }
  }

  private act(s: string): Page {
    const p = this.pg(s);
    if (p.status !== "active") { p.status = "active"; p.startedAt = Date.now(); p.steps = []; p.attempt = 0; }
    return p;
  }

  private pg(s: string): Page {
    return this.pages.find((x) => x.slug === s) ??
      (() => { const x: Page = { slug: s, title: s, status: "active", startedAt: Date.now(), attempt: 0, steps: [] }; this.pages.push(x); return x; })();
  }

  // ── render ──

  private render() {
    this.tick++;
    this.eraseLive();

    const lines: string[] = [];
    const sp = SP[this.tick % SP.length];
    const el = this.dur(Date.now() - this.started);

    if (!this.catalogDone) {
      lines.push(`  ${sp} 正在分析仓库结构... ${D}${el}${R}`);
      this.writeLive(lines);
      return;
    }

    const tw = process.stderr.columns || 100;
    const total = this.pages.length;
    const secs = new Set(this.pages.map((x) => x.section).filter(Boolean)).size;
    const done = this.skipN + this.pages.filter((x) => x.status === "done").length;

    // ── header ──
    const hdr = `── 目录 · ${total} 章${secs ? ` · ${secs} 节` : ""} `;
    lines.push(`${D}${hdr}${"─".repeat(Math.max(0, tw - vis(hdr)))}${R}`);
    lines.push(`  ${G}✓${R} 目录规划  ${D}[完成]${R}`);
    lines.push("");

    if (this.skipN > 0) lines.push(`  ${D}⊘ 1-${this.skipN} 已完成（上次运行），跳过${R}`);

    // ── all chapters ──
    let lastSec = "";
    for (let i = 0; i < this.pages.length; i++) {
      const pg = this.pages[i];
      if (pg.status === "skipped") continue;

      if (pg.section && pg.section !== lastSec) {
        lastSec = pg.section;
        lines.push(`${D}  ┈ ${pg.section} ┈${R}`);
      }

      const n = String(i + 1).padStart(2);

      if (pg.status === "done") {
        const att = pg.attempt > 0 ? ` ${D}(${pg.attempt + 1}次)${R}` : "";
        lines.push(`  ${G}✓${R} ${n}. ${pg.title}${att}  ${D}${this.dur(pg.elapsed ?? 0)}${R}`);
      } else if (pg.status === "active") {
        const phase = pg.phase ?? "准备中";
        const pel = this.dur(Date.now() - (pg.startedAt ?? Date.now()));
        lines.push(`  ${C}→${R} ${n}. ${pg.title}  ${Y}[${phase}]${R} ${D}${pel}${R}`);
        if (pg.steps.length) {
          lines.push(`       ${D}${pg.steps.join(" → ")}${R}`);
        }
      } else {
        lines.push(`  ${D}○ ${n}. ${pg.title}${R}`);
      }
    }

    lines.push("");

    // ── progress bar ──
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const bw = 20;
    const filled = total > 0 ? Math.round((done / total) * bw) : 0;
    const bar = "▓".repeat(filled) + "░".repeat(bw - filled);
    let eta = "";
    const dts = this.pages.filter((x) => x.status === "done" && x.elapsed).map((x) => x.elapsed!);
    if (dts.length) eta = ` · 预计 ~${this.dur((total - done) * (dts.reduce((a, b) => a + b, 0) / dts.length))}`;
    lines.push(`  ${bar} ${done}/${total} ${pct}% · 总耗时 ${el}${eta}`);

    this.writeLive(lines);
  }

  private writeLive(lines: string[]) {
    // Write all lines as a single write to avoid interleaving
    process.stderr.write(lines.join("\n") + "\n");
    this.liveLines = lines.length;
  }

  /** Move cursor to panel start, then clear everything below. */
  private eraseLive() {
    if (this.liveLines === 0) return;
    // Move up N lines in one shot, then clear from cursor to end of screen
    process.stderr.write(`\x1b[${this.liveLines}A\x1b[J`);
    this.liveLines = 0;
  }

  private dur(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60); const sv = s % 60;
    if (m < 60) return sv ? `${m}m${sv}s` : `${m}m`;
    return `${Math.floor(m / 60)}h${m % 60}m`;
  }
}

function vis(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}
