/**
 * CLI progress renderer — event-driven, zero ANSI cursor movement.
 *
 * - Catalog done → print chapter list once (static)
 * - Page done → print ✓ line permanently
 * - Active page → single \r line updated only on event + 1s timer
 * - No \x1b[A, no \x1b[s/u, no \x1b[J — maximum terminal compat
 */

import type { AppEvent } from "@reporead/core";

const DIM = "\x1b[2m";
const RST = "\x1b[0m";
const GRN = "\x1b[32m";
const YLW = "\x1b[33m";
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
  private skipCount = 0;
  private catalogPrinted = false;
  private listPrinted = false;
  private donePrinted = 0;

  setPageList(p: Array<{ slug: string; title: string; section?: string }>) {
    this.pages = p.map((x) => ({ slug: x.slug, title: x.title, section: x.section, status: "pending" as const, attempt: 0, steps: [] }));
  }
  setResumeSkipped(n: number) {
    this.skipCount = n;
    for (let i = 0; i < n && i < this.pages.length; i++) this.pages[i].status = "skipped";
  }
  start() {
    this.started = Date.now();
    this.timer = setInterval(() => this.tickStatus(), 1000);
  }
  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  readonly onEvent = (e: AppEvent) => { this.handle(e); this.flush(); this.tickStatus(); };

  printSummary(ok: boolean, job: { versionId: string; id: string; summary: { succeededPages?: number; totalPages?: number } }) {
    this.stop(); this.clearLine();
    const el = this.dur(Date.now() - this.started);
    const ts = this.pages.filter((p) => p.status === "done" && p.elapsed).map((p) => p.elapsed!);
    const avg = ts.length ? this.dur(ts.reduce((a, b) => a + b, 0) / ts.length) : "N/A";
    console.log();
    if (ok) {
      console.log(`  ${GRN}✓${RST} 生成完成!  版本: ${job.versionId}  页数: ${job.summary.succeededPages ?? 0}/${job.summary.totalPages ?? 0}  耗时: ${el}  平均: ${avg}`);
    } else {
      console.log(`  ✗ 生成失败  任务: ${job.id}  耗时: ${el}`);
      console.log(`    续跑: repo-read generate --resume ${job.id}`);
    }
    console.log();
  }

  // ── events ──

  private handle(e: AppEvent) {
    const s = e.pageSlug ?? "";
    const p = e.payload as Record<string, unknown>;
    switch (e.type) {
      case "catalog.completed": this.printCatalog(); break;
      case "job.resumed": this.printCatalog(); break;
      case "page.evidence_planned": this.act(s).phase = "收集证据"; break;
      case "page.evidence_collected": { const pg = this.pg(s); pg.steps.push(`${(p.citationCount as number) ?? 0}条引用`); pg.phase = "规划大纲"; break; }
      case "page.drafting": { const pg = this.act(s); if (pg.attempt > 0) pg.phase = "重写中"; else { if (pg.steps.length && !pg.steps.some((x) => x.includes("大纲"))) pg.steps.push("大纲"); pg.phase = "撰写中"; } break; }
      case "page.drafted": this.pg(s).phase = "审阅中"; break;
      case "page.reviewed": { const pg = this.pg(s); if ((p.verdict as string) === "revise") { pg.attempt++; pg.steps.push(`修订#${pg.attempt}`); pg.phase = "重写中"; } else pg.phase = "校验中"; break; }
      case "page.validated": { const pg = this.pg(s); pg.status = "done"; pg.elapsed = Date.now() - (pg.startedAt ?? Date.now()); pg.phase = undefined; break; }
    }
  }

  private act(s: string): Page { const p = this.pg(s); if (p.status !== "active") { p.status = "active"; p.startedAt = Date.now(); p.steps = []; p.attempt = 0; } return p; }
  private pg(s: string): Page { return this.pages.find((p) => p.slug === s) ?? (() => { const p: Page = { slug: s, title: s, status: "active", startedAt: Date.now(), attempt: 0, steps: [] }; this.pages.push(p); return p; })(); }

  // ── output ──

  private printCatalog() {
    if (this.catalogPrinted) return;
    this.catalogPrinted = true;
    this.clearLine();
    const tw = process.stderr.columns || 100;
    const total = this.pages.length;
    const secs = new Set(this.pages.map((p) => p.section).filter(Boolean)).size;
    const hdr = `── 目录 · ${total} 章${secs ? ` · ${secs} 节` : ""} `;
    console.log(`${DIM}${hdr}${"─".repeat(Math.max(0, tw - hdr.length))}${RST}`);
    console.log(`  ${GRN}✓${RST} 目录规划  ${DIM}[完成]${RST}`);
  }

  /** Print full chapter list once, right after catalog. */
  private printList() {
    if (this.listPrinted || !this.catalogPrinted) return;
    this.listPrinted = true;
    this.clearLine();
    if (this.skipCount > 0) {
      console.log(`  ${DIM}⊘ 1-${this.skipCount} 已完成（上次运行），跳过${RST}`);
    }
    let lastSec = "";
    for (let i = 0; i < this.pages.length; i++) {
      const p = this.pages[i];
      if (p.status === "skipped") continue;
      if (p.section && p.section !== lastSec) { lastSec = p.section; console.log(`${DIM}  ┈ ${p.section} ┈${RST}`); }
      const n = String(i + 1).padStart(2);
      console.log(`  ${DIM}○ ${n}. ${p.title}${RST}`);
    }
    console.log();
  }

  /** Print newly completed pages as permanent lines. */
  private flush() {
    // Print list on first page event
    if (!this.listPrinted && this.pages.some((p) => p.status === "active" || p.status === "done")) {
      this.printList();
    }

    let count = 0;
    for (let i = this.skipCount; i < this.pages.length; i++) {
      if (this.pages[i].status !== "done") break;
      count++;
      if (count <= this.donePrinted) continue;
      this.clearLine();
      const p = this.pages[i];
      const n = String(i + 1).padStart(2);
      const el = this.dur(p.elapsed ?? 0);
      const att = p.attempt > 0 ? ` (${p.attempt + 1}次)` : "";
      console.log(`  ${GRN}✓${RST} ${n}. ${p.title}${att}  ${DIM}${el}${RST}`);
    }
    this.donePrinted = count;
  }

  /** Single \r status line for current page. */
  private tickStatus() {
    this.tick++;
    const sp = SP[this.tick % SP.length];
    const el = this.dur(Date.now() - this.started);
    const done = this.skipCount + this.pages.filter((p) => p.status === "done").length;
    const total = this.pages.length || "?";
    const active = this.pages.find((p) => p.status === "active");

    let line: string;
    if (!this.catalogPrinted) {
      line = `  ${sp} 正在分析仓库结构... ${DIM}${el}${RST}`;
    } else if (active) {
      const idx = this.pages.indexOf(active) + 1;
      const phase = active.phase ?? "准备中";
      const chain = active.steps.length ? ` ${DIM}${active.steps.join("→")}${RST}` : "";
      const pel = this.dur(Date.now() - (active.startedAt ?? Date.now()));
      line = `  ${YLW}${sp}${RST} [${done}/${total}] ${active.title} ${DIM}[${phase}]${RST}${chain} ${DIM}${pel}  总${el}${RST}`;
    } else {
      line = `  ${DIM}${done}/${total} 完成 · ${el}${RST}`;
    }

    const tw = process.stderr.columns || 120;
    const vis = line.replace(/\x1b\[[0-9;]*m/g, "").length;
    process.stderr.write(`\r${line}${" ".repeat(Math.max(0, tw - vis))}`);
  }

  private clearLine() {
    const tw = process.stderr.columns || 120;
    process.stderr.write(`\r${" ".repeat(tw)}\r`);
  }

  private dur(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60); const sv = s % 60;
    if (m < 60) return sv ? `${m}m${sv}s` : `${m}m`;
    return `${Math.floor(m / 60)}h${m % 60}m`;
  }
}
