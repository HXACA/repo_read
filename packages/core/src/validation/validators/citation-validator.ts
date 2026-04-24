import * as fs from "node:fs";
import * as path from "node:path";
import type { CitationRecord } from "../../types/generation.js";
import type { ValidationReport } from "../../types/validation.js";

/**
 * Validate every `[cite:...]` record a drafted page emitted.
 *
 * Two checks run (a third is optional):
 *
 * 1. **Scope check** — `file` citations must reference a target in
 *    `knownFiles` (the catalog-assigned `coveredFiles` list for this page).
 *    This catches drafts that wander outside their brief.
 * 2. **Page link check** — `page` citations must point to a known sibling
 *    page.
 * 3. **Disk-existence check (optional, enabled via `repoRoot`)** — every
 *    `file` citation's target must resolve to a real path on disk. Without
 *    this, a drafter can cite imaginary paths (e.g. `pkg/sysctl/sysctl.go`
 *    when only `sysctl_test.go` exists) and the scope check misses it when
 *    `knownFiles` is glob-shaped (`pkg/*.go`).
 *
 * Reference case: CubeSandbox 2026-04-22 page 7. The catalog assigned
 * glob-shaped coveredFiles like `Cubelet/pkg/log/*.go`, the drafter emitted
 * citations to `Cubelet/pkg/log/context.go` (never existed), and the scope
 * check couldn't refute them because the glob string wasn't in `knownFiles`
 * as a concrete path. The disk check turns every such cite into a hard
 * validation error.
 */
export function validateCitations(
  citations: CitationRecord[],
  knownFiles: string[],
  knownPages: string[],
  pageSlug: string,
  options?: { repoRoot?: string },
): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fileSet = new Set(knownFiles);
  const pageSet = new Set(knownPages);
  const repoRoot = options?.repoRoot;

  if (citations.length === 0) {
    warnings.push(`${pageSlug}: no citations — page may lack evidence basis`);
    return { target: "page", passed: true, errors, warnings };
  }

  for (const c of citations) {
    if (c.kind === "file") {
      if (!fileSet.has(c.target)) {
        errors.push(`${pageSlug}: citation references unknown file "${c.target}"`);
      }
      // Disk-existence check is the last line of defense against
      // hallucinated paths that happen to overlap the scope allowlist
      // (e.g. glob entries in knownFiles).
      if (repoRoot) {
        const abs = path.resolve(repoRoot, c.target);
        if (!fs.existsSync(abs)) {
          errors.push(
            `${pageSlug}: citation file "${c.target}" does not exist on disk (checked ${abs})`,
          );
        }
      }
    }
    if (c.kind === "page" && !pageSet.has(c.target)) {
      errors.push(`${pageSlug}: citation references unknown page "${c.target}"`);
    }
  }

  return { target: "page", passed: errors.length === 0, errors, warnings };
}
