/**
 * CLI progress panel for `repo-read generate`.
 *
 * Full-screen chapter list with real-time status updates, refreshed
 * every second via ANSI escape codes. No third-party TUI dependencies.
 *
 * See docs/superpowers/specs/2026-04-11-cli-progress-panel-design.md
 */

import type { AppEvent } from "@reporead/core";

// ── ANSI helpers ──────────────────────────────────────────────────
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const UP = "\x1b[A";
const CLEAR_LINE = "\x1b[2K";

// ── Types ─────────────────────────────────────────────────────────

type PageDisplayState = {
  slug: string;
  title: string;
  section?: string;
  status: "pending" | "active" | "done" | "skipped";
  startedAt?: number;
  elapsed?: number;
  attempt: number;
  /** Accumulated sub-step breadcrumb fragments, e.g. ["evidence: 12 citations", "outline: 5 sections"] */
  steps: string[];
  /** Current phase label shown at the end of the step chain */
  currentPhase?: string;
};

// ── Renderer ──────────────────────────────────────────────────────

export class ProgressRenderer {
  private pages: PageDisplayState[] = [];
  private startedAt = Date.now();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastLineCount = 0;
  private resumeSkipped = 0;
  private catalogLine = "";
  private sectionCount = 0;

  // ── Public API ────────────────────────────────────────────────

  /** Initialize from wiki.json reading_order. Call before start(). */
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

  /** Mark the first N pages as skipped (resume scenario). */
  setResumeSkipped(n: number): void {
    this.resumeSkipped = n;
    for (let i = 0; i < n && i < this.pages.length; i++) {
      this.pages[i].status = "skipped";
    }
  }

  /** Start the 1-second refresh timer. */
  start(): void {
    this.startedAt = Date.now();
    this.refreshTimer = setInterval(() => this.render(), 1000);
  }

  /** Stop the refresh timer. */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /** Pipeline event callback. Pass as `onEvent` to pipeline.run(). */
  readonly onEvent = (event: AppEvent): void => {
    this.handleEvent(event);
    this.render();
  };

  /** Print final summary and stop. */
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
    const avgPage =
      doneTimes.length > 0
        ? this.fmtDur(doneTimes.reduce((a, b) => a + b, 0) / doneTimes.length)
        : "N/A";

    if (success) {
      console.log(`\n  ${GREEN}✓${RESET} Generation complete!`);
      console.log(`    Version:  ${job.versionId}`);
      console.log(
        `    Pages:    ${job.summary.succeededPages ?? 0}/${job.summary.totalPages ?? 0}`,
      );
      console.log(`    Elapsed:  ${elapsed}`);
      console.log(`    Avg/page: ${avgPage}`);
    } else {
      console.log(`\n  ✗ Generation failed`);
      console.log(`    Job:     ${job.id}`);
      console.log(`    Elapsed: ${elapsed}`);
      console.log(`    Resume:  repo-read generate --resume ${job.id}`);
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
        this.catalogLine = `  ${GREEN}✓${RESET} Catalog: ${total} pages · ${this.sectionCount} sections`;
        break;
      }

      case "job.resumed":
        this.catalogLine =
          this.resumeSkipped > 0
            ? ""  // Will be shown as collapsed skip line in render
            : "";
        break;

      case "page.evidence_planned":
        this.activatePage(slug);
        this.pageFor(slug).currentPhase = "collecting evidence...";
        break;

      case "page.evidence_collected": {
        const p = this.pageFor(slug);
        const n = (payload.citationCount as number) ?? 0;
        p.steps.push(`evidence: ${n} citations`);
        p.currentPhase = "planning outline...";
        break;
      }

      case "page.drafting": {
        const p = this.activatePage(slug);
        if (p.attempt > 0) {
          p.currentPhase = "drafting...";
        } else if (p.steps.length > 0) {
          // Outline doesn't have its own event; infer it completed
          // if we had evidence before drafting.
          if (!p.steps.some((s) => s.startsWith("outline:"))) {
            p.steps.push("outline");
          }
          p.currentPhase = "drafting...";
        } else {
          p.currentPhase = "drafting...";
        }
        break;
      }

      case "page.drafted": {
        const p = this.pageFor(slug);
        p.currentPhase = "reviewing...";
        break;
      }

      case "page.reviewed": {
        const p = this.pageFor(slug);
        const verdict = payload.verdict as string;
        if (verdict === "revise") {
          p.attempt++;
          p.steps.push(`revise #${p.attempt}`);
          p.currentPhase = "re-drafting...";
        } else {
          p.currentPhase = "validating...";
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
    // Fallback: page not in list (shouldn't happen, but defensive)
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
    const lines: string[] = [];

    // Catalog line
    if (this.catalogLine) {
      lines.push(this.catalogLine);
      lines.push("");
    } else if (this.pages.length === 0) {
      lines.push("  ◦ Cataloging repository...");
      lines.push("");
    }

    // Resume skip line
    if (this.resumeSkipped > 0) {
      lines.push(
        `  ${DIM}⊘ 1-${this.resumeSkipped} 已完成（上次运行），跳过${RESET}`,
      );
      lines.push("");
    }

    // Chapter list
    let lastSection = "";
    const doneCount = this.pages.filter(
      (p) => p.status === "done" || p.status === "skipped",
    ).length;

    for (let i = 0; i < this.pages.length; i++) {
      const p = this.pages[i];
      if (p.status === "skipped") continue; // collapsed into skip line

      // Section divider
      if (p.section && p.section !== lastSection) {
        lastSection = p.section;
        const label = ` ${p.section} `;
        const pad = Math.max(0, 60 - label.length);
        lines.push(`  ${DIM}──${label}${"─".repeat(pad)}${RESET}`);
      }

      const num = String(i + 1).padStart(2);

      switch (p.status) {
        case "done": {
          const elapsed = this.fmtDur(p.elapsed ?? 0);
          const attempts =
            p.attempt > 0
              ? ` ${DIM}[${p.attempt + 1} attempts]${RESET}`
              : "";
          lines.push(
            `  ${GREEN}✓${RESET} ${num}. ${p.title}${attempts}${this.padRight(elapsed, p.title, attempts)}`,
          );
          break;
        }
        case "active": {
          const elapsed = this.fmtDur(
            Date.now() - (p.startedAt ?? Date.now()),
          );
          lines.push(
            `  ${YELLOW}→${RESET} ${num}. ${p.title}${this.padRight(elapsed, p.title, "")}`,
          );
          // Sub-step chain
          const chain = [...p.steps];
          if (p.currentPhase) chain.push(`${CYAN}${p.currentPhase}${RESET}`);
          if (chain.length > 0) {
            lines.push(`       ${chain.join(" → ")}`);
          }
          break;
        }
        case "pending": {
          lines.push(`  ${DIM}○ ${num}. ${p.title}${RESET}`);
          break;
        }
      }
    }

    // Progress bar
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
        const avg = doneTimes.reduce((a, b) => a + b, 0) / doneTimes.length;
        const remaining = total - doneCount;
        eta = ` · ~${this.fmtDur(remaining * avg)} left`;
      }

      lines.push("");
      lines.push(
        `  ${bar} ${doneCount}/${total} ${pct}% · ${elapsed} elapsed${eta}`,
      );
    }

    // Clear previous and write
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

  /** Right-pad to align elapsed time near column 65. */
  private padRight(elapsed: string, title: string, extra: string): string {
    // Strip ANSI for length calculation
    const visibleExtra = extra.replace(/\x1b\[[0-9;]*m/g, "");
    const used = 6 + title.length + visibleExtra.length; // "  ✓ NN. " prefix ≈ 6
    const gap = Math.max(1, 65 - used - elapsed.length);
    return " ".repeat(gap) + `${DIM}${elapsed}${RESET}`;
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
