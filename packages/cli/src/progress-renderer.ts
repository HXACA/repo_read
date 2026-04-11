/**
 * Real-time CLI progress renderer for generation pipeline.
 *
 * Listens to pipeline events via the `onEvent` callback and renders
 * a compact, continuously-updating progress display:
 *
 *   ✓ Catalog: 20 pages planned                                8s
 *
 *   [3/20] system-architecture
 *     ◦ evidence → 12 citations
 *     ◦ outline → 5 sections
 *     ◦ drafting...
 *   ─────────────────────────────────────
 *   Progress: 2/20 ▓▓░░░░░░░░ 10% | 3m12s elapsed | ~28m left
 */

import type { AppEvent } from "@reporead/core";

type PageState = {
  slug: string;
  title?: string;
  startedAt: number;
  phase: string;
  attempt: number;
  lastVerdict?: string;
  evidenceCitations?: number;
  finishedAt?: number;
  elapsed?: number;
};

export class ProgressRenderer {
  private totalPages = 0;
  private completedPages = 0;
  private currentPage: PageState | null = null;
  private pageTimings: number[] = [];
  private startedAt = Date.now();
  private catalogDone = false;
  private lastLineCount = 0;

  /** Pass this as `onEvent` to the pipeline. */
  readonly onEvent = (event: AppEvent): void => {
    this.handleEvent(event);
    this.render();
  };

  private handleEvent(event: AppEvent): void {
    const slug = event.pageSlug ?? "";
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
      case "job.started":
        this.startedAt = Date.now();
        break;

      case "catalog.completed":
        this.totalPages = (payload.totalPages as number) ?? 0;
        this.catalogDone = true;
        break;

      case "job.resumed":
        // On resume, totalPages is already set from the wiki.json
        break;

      case "page.evidence_planned":
        // Starting a new page
        this.currentPage = {
          slug,
          startedAt: Date.now(),
          phase: "collecting evidence",
          attempt: 0,
        };
        break;

      case "page.evidence_collected":
        if (this.currentPage) {
          this.currentPage.evidenceCitations =
            (payload.citationCount as number) ?? 0;
          this.currentPage.phase = "planning outline";
        }
        break;

      case "page.drafting":
        if (!this.currentPage || this.currentPage.slug !== slug) {
          // No evidence phase (e.g. no fork.workers) — start tracking here
          this.currentPage = {
            slug,
            startedAt: Date.now(),
            phase: "drafting",
            attempt: 0,
          };
        } else {
          this.currentPage.phase =
            this.currentPage.attempt > 0 ? "re-drafting" : "drafting";
        }
        break;

      case "page.drafted":
        if (this.currentPage) {
          this.currentPage.phase = "reviewing";
        }
        break;

      case "page.reviewed": {
        const verdict = payload.verdict as string;
        if (this.currentPage) {
          this.currentPage.lastVerdict = verdict;
          if (verdict === "revise") {
            this.currentPage.attempt++;
            this.currentPage.phase = `revise #${this.currentPage.attempt}`;
          } else {
            this.currentPage.phase = "validating";
          }
        }
        break;
      }

      case "page.validated":
        if (this.currentPage) {
          const elapsed = Date.now() - this.currentPage.startedAt;
          this.currentPage.finishedAt = Date.now();
          this.currentPage.elapsed = elapsed;
          this.pageTimings.push(elapsed);
          this.completedPages++;
          this.currentPage.phase = "done";
        }
        break;

      case "job.completed":
      case "job.failed":
        // Final render handled by the caller
        break;
    }
  }

  private render(): void {
    const lines: string[] = [];

    // --- Catalog status ---
    if (this.catalogDone) {
      lines.push(`  ✓ Catalog: ${this.totalPages} pages planned`);
    } else if (!this.currentPage) {
      lines.push("  ◦ Cataloging repository...");
    }

    // --- Current page ---
    if (this.currentPage) {
      const p = this.currentPage;
      const pageNum = this.completedPages + (p.phase === "done" ? 0 : 1);
      const total = this.totalPages || "?";

      if (p.phase === "done") {
        const elapsed = this.formatDuration(p.elapsed ?? 0);
        lines.push(`  ✓ [${pageNum}/${total}] ${p.slug}  ${elapsed}`);
      } else {
        lines.push(`  [${pageNum}/${total}] ${p.slug}`);
        // Sub-status line
        const parts: string[] = [];
        if (p.evidenceCitations != null) {
          parts.push(`evidence: ${p.evidenceCitations} citations`);
        }
        if (p.attempt > 0) {
          parts.push(`attempt ${p.attempt + 1}`);
        }
        parts.push(p.phase);
        lines.push(`    ◦ ${parts.join(" → ")}`);
      }
    }

    // --- Progress bar ---
    if (this.totalPages > 0) {
      const pct = Math.round((this.completedPages / this.totalPages) * 100);
      const barWidth = 20;
      const filled = Math.round((this.completedPages / this.totalPages) * barWidth);
      const bar = "▓".repeat(filled) + "░".repeat(barWidth - filled);
      const elapsed = this.formatDuration(Date.now() - this.startedAt);

      let eta = "";
      if (this.pageTimings.length > 0) {
        const avgMs =
          this.pageTimings.reduce((a, b) => a + b, 0) / this.pageTimings.length;
        const remaining = this.totalPages - this.completedPages;
        eta = ` | ~${this.formatDuration(remaining * avgMs)} left`;
      }

      lines.push(
        `  ${bar} ${this.completedPages}/${this.totalPages} ${pct}% | ${elapsed} elapsed${eta}`,
      );
    }

    // --- Clear previous output and write new ---
    this.clearLines(this.lastLineCount);
    const output = lines.join("\n");
    process.stderr.write(output + "\n");
    this.lastLineCount = lines.length;
  }

  /** Print final summary (non-clearing). */
  printSummary(success: boolean, job: { versionId: string; id: string; summary: { succeededPages?: number; totalPages?: number } }): void {
    this.clearLines(this.lastLineCount);
    this.lastLineCount = 0;
    const elapsed = this.formatDuration(Date.now() - this.startedAt);
    const avgPage =
      this.pageTimings.length > 0
        ? this.formatDuration(
            this.pageTimings.reduce((a, b) => a + b, 0) / this.pageTimings.length,
          )
        : "N/A";

    if (success) {
      console.log(`\n  ✓ Generation complete!`);
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

  setTotalPages(n: number): void {
    this.totalPages = n;
  }

  setCompletedPages(n: number): void {
    this.completedPages = n;
  }

  private formatDuration(ms: number): string {
    const totalSec = Math.round(ms / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min < 60) return `${min}m${sec > 0 ? sec + "s" : ""}`;
    const hr = Math.floor(min / 60);
    const remMin = min % 60;
    return `${hr}h${remMin > 0 ? remMin + "m" : ""}`;
  }

  private clearLines(count: number): void {
    for (let i = 0; i < count; i++) {
      process.stderr.write("\x1b[A\x1b[2K");
    }
  }
}
