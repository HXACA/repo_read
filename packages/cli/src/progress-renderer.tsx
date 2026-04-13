/**
 * CLI progress panel using Ink (React for the terminal).
 *
 * Uses Ink's `Static` component for completed items (printed once, scroll naturally)
 * and dynamic rendering for the active chapter + progress bar.
 * Handles terminal height, wrapping, and resize automatically.
 */

import React, { useState, useEffect } from "react";
import { render, Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { AppEvent } from "@reporead/core";

type PageStatus = "pending" | "active" | "done" | "skipped";

type Page = {
  slug: string;
  title: string;
  section?: string;
  status: PageStatus;
  startedAt?: number;
  elapsed?: number;
  attempt: number;
  steps: string[];
  phase?: string;
};

function dur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sv = s % 60;
  if (m < 60) return sv ? `${m}m${sv}s` : `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

// ── Ink components ──

function CatalogHeader({ total, sections }: { total: number; sections: number }) {
  return (
    <Box flexDirection="column">
      <Text dimColor>── 目录 · {total} 章{sections > 0 ? ` · ${sections} 节` : ""} ──</Text>
      <Text><Text color="green">✓</Text> 目录规划  <Text dimColor>[完成]</Text></Text>
      <Text> </Text>
    </Box>
  );
}

function CompletedPage({ page, index }: { page: Page; index: number }) {
  const n = String(index + 1).padStart(2);
  const att = page.attempt > 0 ? ` (${page.attempt + 1}次)` : "";
  return (
    <Text>
      {"  "}<Text color="green">✓</Text> {n}. {page.title}{att}{"  "}<Text dimColor>{dur(page.elapsed ?? 0)}</Text>
    </Text>
  );
}

function SectionHeader({ name }: { name: string }) {
  return <Text dimColor>  ┈ {name} ┈</Text>;
}

function ActivePage({ page, index, tick: _tick }: { page: Page; index: number; tick: number }) {
  const n = String(index + 1).padStart(2);
  const phase = page.phase ?? "准备中";
  const pel = dur(Date.now() - (page.startedAt ?? Date.now()));
  return (
    <Box flexDirection="column">
      <Text>
        {"  "}<Text color="cyan">→</Text> {n}. {page.title}{"  "}
        <Text color="yellow">[{phase}]</Text> <Text dimColor>{pel}</Text>
      </Text>
      {page.steps.length > 0 && (
        <Text dimColor>       {page.steps.join(" → ")}</Text>
      )}
    </Box>
  );
}

function PendingPage({ page, index }: { page: Page; index: number }) {
  const n = String(index + 1).padStart(2);
  return <Text dimColor>  ○ {n}. {page.title}</Text>;
}

function ProgressBar({ done, total, elapsed, pages }: { done: number; total: number; elapsed: number; pages: Page[] }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const bw = 20;
  const filled = total > 0 ? Math.round((done / total) * bw) : 0;
  const bar = "▓".repeat(filled) + "░".repeat(bw - filled);
  const dts = pages.filter((x) => x.status === "done" && x.elapsed).map((x) => x.elapsed!);
  const eta = dts.length ? ` · 预计 ~${dur((total - done) * (dts.reduce((a, b) => a + b, 0) / dts.length))}` : "";
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text>  {bar} {done}/{total} {pct}% · 总耗时 {dur(elapsed)}{eta}</Text>
    </Box>
  );
}

function CatalogSpinner({ elapsed }: { elapsed: number }) {
  return (
    <Text>
      {"  "}<Spinner type="dots" /> 正在分析仓库结构... <Text dimColor>{dur(elapsed)}</Text>
    </Text>
  );
}

// ── Main Ink app ──

type ProgressState = {
  pages: Page[];
  catalogDone: boolean;
  skipN: number;
  started: number;
  tick: number;
};

function ProgressApp({ state }: { state: ProgressState }) {
  const { pages, catalogDone, skipN, started, tick } = state;

  if (!catalogDone) {
    return <CatalogSpinner elapsed={Date.now() - started} />;
  }

  const total = pages.length;
  const sectionCount = new Set(pages.map((x) => x.section).filter(Boolean)).size;
  const done = skipN + pages.filter((x) => x.status === "done").length;

  // Everything is dynamic — Ink handles efficient re-rendering.
  // No Static component: it causes completed items to float above the header.
  const lines: React.ReactNode[] = [];

  lines.push(<CatalogHeader key="hdr" total={total} sections={sectionCount} />);

  if (skipN > 0) {
    lines.push(<Text key="skip" dimColor>  ⊘ 1-{skipN} 已完成（上次运行），跳过</Text>);
  }

  // All pages in order: done ✓, active →, pending ○
  let lastSec = "";
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    if (pg.status === "skipped") continue;

    if (pg.section && pg.section !== lastSec) {
      lastSec = pg.section;
      lines.push(<SectionHeader key={`sec-${i}`} name={pg.section} />);
    }

    if (pg.status === "done") {
      lines.push(<CompletedPage key={pg.slug} page={pg} index={i} />);
    } else if (pg.status === "active") {
      lines.push(<ActivePage key={pg.slug} page={pg} index={i} tick={tick} />);
    } else {
      lines.push(<PendingPage key={pg.slug} page={pg} index={i} />);
    }
  }

  return (
    <Box flexDirection="column">
      {lines}
      <ProgressBar done={done} total={total} elapsed={Date.now() - started} pages={pages} />
    </Box>
  );
}

// ── Public API (same interface as before) ──

export class ProgressRenderer {
  private pages: Page[] = [];
  private started = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;
  private skipN = 0;
  private catalogDone = false;
  private inkInstance: ReturnType<typeof render> | null = null;
  private updateFn: (() => void) | null = null;

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

    // Create a wrapper that holds state and exposes an update trigger
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    function App() {
      const [, setTick] = useState(0);

      // Expose the update trigger
      useEffect(() => {
        self.updateFn = () => setTick((t) => t + 1);
        return () => { self.updateFn = null; };
      }, []);

      return (
        <ProgressApp
          state={{
            pages: self.pages,
            catalogDone: self.catalogDone,
            skipN: self.skipN,
            started: self.started,
            tick: self.tick,
          }}
        />
      );
    }

    this.inkInstance = render(React.createElement(App), {
      stdout: process.stderr as unknown as NodeJS.WriteStream,
    });

    // Timer for spinner/elapsed updates
    this.timer = setInterval(() => {
      this.tick++;
      this.updateFn?.();
    }, 500);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.inkInstance) {
      this.inkInstance.unmount();
      this.inkInstance = null;
    }
  }

  readonly onEvent = (e: AppEvent) => {
    this.handle(e);
    this.updateFn?.();
  };

  printSummary(ok: boolean, job: { versionId: string; id: string; summary: { succeededPages?: number; totalPages?: number } }) {
    this.stop();
    const el = dur(Date.now() - this.started);
    const ts = this.pages.filter((p) => p.status === "done" && p.elapsed).map((p) => p.elapsed!);
    const avg = ts.length ? dur(ts.reduce((a, b) => a + b, 0) / ts.length) : "N/A";
    console.log();
    if (ok) {
      console.log(`  \x1b[32m✓\x1b[0m 生成完成!  版本: ${job.versionId}  页数: ${job.summary.succeededPages ?? 0}/${job.summary.totalPages ?? 0}  耗时: ${el}  平均: ${avg}`);
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
}
