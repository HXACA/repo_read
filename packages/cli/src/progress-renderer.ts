/**
 * CLI progress panel. Uses cursor-up + clear-line for in-place refresh.
 * Terminal support verified: \r, \x1b[A, \x1b[2K all work.
 *
 * Approach: write N lines, remember N, next render moves up N lines
 * and overwrites. Only the "live zone" is refreshed — permanent lines
 * (catalog header, chapter list) are printed once via console.log and
 * never touched again.
 */

import type { AppEvent } from "@reporead/core";

const D = "\x1b[2m";  // dim
const R = "\x1b[0m";  // reset
const G = "\x1b[32m"; // green
const Y = "\x1b[33m"; // yellow
const UP_CLEAR = "\x1b[A\x1b[2K"; // move up 1 line + clear it
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
  private catalogPrinted = false;
  private listPrinted = false;
  private donePrinted = 0;
  /** How many "live zone" lines were written last time. */
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
    this.timer = setInterval(() => this.refreshLive(), 500);
  }

  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  readonly onEvent = (e: AppEvent) => {
    this.handle(e);
    this.printNewDone();
    this.refreshLive();
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

  // ── event handling ──

  private handle(e: AppEvent) {
    const s = e.pageSlug ?? "";
    const p = e.payload as Record<string, unknown>;
    switch (e.type) {
      case "catalog.completed": this.doCatalog(); break;
      case "job.resumed": this.doCatalog(); break;
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

  // ── permanent prints (never erased) ──

  private doCatalog() {
    if (this.catalogPrinted) return;
    this.catalogPrinted = true;
    this.eraseLive(); // clear spinner
    const tw = process.stderr.columns || 100;
    const total = this.pages.length;
    const secs = new Set(this.pages.map((x) => x.section).filter(Boolean)).size;
    const hdr = `── 目录 · ${total} 章${secs ? ` · ${secs} 节` : ""} `;
    console.log(`${D}${hdr}${"─".repeat(Math.max(0, tw - vis(hdr)))}${R}`);
    console.log(`  ${G}✓${R} 目录规划  ${D}[完成]${R}`);
    console.log();
    // Print full chapter list
    if (this.skipN > 0) console.log(`  ${D}⊘ 1-${this.skipN} 已完成（上次运行），跳过${R}`);
    let lastSec = "";
    for (let i = 0; i < this.pages.length; i++) {
      const pg = this.pages[i];
      if (pg.status === "skipped") continue;
      if (pg.section && pg.section !== lastSec) { lastSec = pg.section; console.log(`${D}  ┈ ${pg.section} ┈${R}`); }
      console.log(`  ${D}○ ${String(i + 1).padStart(2)}. ${pg.title}${R}`);
    }
    console.log();
    this.listPrinted = true;
  }

  /** Print newly completed pages — permanent lines above the live zone. */
  private printNewDone() {
    let count = 0;
    for (let i = this.skipN; i < this.pages.length; i++) {
      if (this.pages[i].status !== "done") break;
      count++;
      if (count <= this.donePrinted) continue;
      this.eraseLive();
      const pg = this.pages[i];
      const n = String(i + 1).padStart(2);
      const el = this.dur(pg.elapsed ?? 0);
      const att = pg.attempt > 0 ? ` (${pg.attempt + 1}次)` : "";
      console.log(`  ${G}✓${R} ${n}. ${pg.title}${att}  ${D}${el}${R}`);
    }
    this.donePrinted = count;
  }

  // ── live zone (erased + redrawn on each refresh) ──

  private refreshLive() {
    this.tick++;
    this.eraseLive();

    const lines: string[] = [];
    const sp = SP[this.tick % SP.length];
    const el = this.dur(Date.now() - this.started);
    const done = this.skipN + this.pages.filter((x) => x.status === "done").length;
    const total = this.pages.length;
    const active = this.pages.find((x) => x.status === "active");

    if (!this.catalogPrinted) {
      // Catalog phase
      lines.push(`  ${sp} 正在分析仓库结构... ${D}${el}${R}`);
    } else if (active) {
      const idx = this.pages.indexOf(active) + 1;
      const phase = active.phase ?? "准备中";
      const chain = active.steps.length ? `  ${D}${active.steps.join(" → ")}${R}` : "";
      const pel = this.dur(Date.now() - (active.startedAt ?? Date.now()));
      lines.push(`  ${Y}${sp}${R} [${done}/${total}] ${active.title}  ${D}[${phase}]${R}  ${D}${pel}${R}${chain}`);
      // Progress bar
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      const bw = 20;
      const filled = total > 0 ? Math.round((done / total) * bw) : 0;
      const bar = "▓".repeat(filled) + "░".repeat(bw - filled);
      let eta = "";
      const dts = this.pages.filter((x) => x.status === "done" && x.elapsed).map((x) => x.elapsed!);
      if (dts.length) eta = ` · 预计 ~${this.dur((total - done) * (dts.reduce((a, b) => a + b, 0) / dts.length))}`;
      lines.push(`  ${bar} ${done}/${total} ${pct}% · ${el}${eta}`);
    } else if (total > 0) {
      lines.push(`  ${D}${done}/${total} 完成 · ${el}${R}`);
    }

    for (const line of lines) {
      process.stderr.write(line + "\n");
    }
    this.liveLines = lines.length;
  }

  /** Erase the live zone by moving up + clearing each line. */
  private eraseLive() {
    for (let i = 0; i < this.liveLines; i++) {
      process.stderr.write(UP_CLEAR);
    }
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
