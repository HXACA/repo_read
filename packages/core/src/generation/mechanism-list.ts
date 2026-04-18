/**
 * Derives a deduplicated list of mechanisms from the evidence ledger.
 * Used by outline, drafter, and reviewer to enforce recall-oriented
 * coverage — nothing in the ledger (with a non-empty note) may be silently
 * skipped by the drafter.
 */

export type Mechanism = {
  /** Stable identifier, formed from citation kind + target (+ locator if present). */
  id: string;
  citation: {
    kind: "file" | "page" | "commit";
    target: string;
    locator?: string;
  };
  /** Short human-readable description, truncated to 120 chars. */
  description: string;
  /**
   * - `must_cite`: the draft must include a `[cite:...]` marker referencing
   *   this citation (target in page.covered_files).
   * - `must_mention`: the draft must mention the target name or description
   *   keywords (worker-discovered, outside covered_files).
   */
  coverageRequirement: "must_cite" | "must_mention";
};

type LedgerLike = {
  id?: string;
  kind: "file" | "page" | "commit" | string;
  target: string;
  note: string;
  locator?: string;
};

const MAX_MECHANISMS = 30;
const MAX_DESCRIPTION_LENGTH = 120;

export function deriveMechanismList(
  ledger: ReadonlyArray<LedgerLike>,
  coveredFiles: ReadonlyArray<string>,
): Mechanism[] {
  const coveredSet = new Set(coveredFiles);
  const seenTargets = new Set<string>();
  const out: Mechanism[] = [];

  for (const entry of ledger) {
    const note = (entry.note ?? "").trim();
    if (!note) continue;
    if (seenTargets.has(entry.target)) continue;

    const kind = normalizeKind(entry.kind);
    // Drop file-kind entries whose target is outside the page's coveredFiles.
    // Citation Guard blocks the drafter from citing these, which makes them
    // unrecoverable missing_coverage findings for the reviewer — triggering
    // revisions the drafter can never resolve. Page/commit kinds are kept
    // because they are cross-references, not scope-bound citations.
    if (kind === "file" && !coveredSet.has(entry.target)) {
      continue;
    }
    seenTargets.add(entry.target);

    const id = buildId(kind, entry.target, entry.locator);
    const description = note.length > MAX_DESCRIPTION_LENGTH
      ? note.slice(0, MAX_DESCRIPTION_LENGTH)
      : note;

    out.push({
      id,
      citation: {
        kind,
        target: entry.target,
        ...(entry.locator ? { locator: entry.locator } : {}),
      },
      description,
      coverageRequirement: coveredSet.has(entry.target) ? "must_cite" : "must_mention",
    });
  }

  // Sort by description length descending (longest first = most informative)
  out.sort((a, b) => b.description.length - a.description.length);

  if (out.length > MAX_MECHANISMS) {
    return out.slice(0, MAX_MECHANISMS);
  }
  return out;
}

function normalizeKind(kind: string): "file" | "page" | "commit" {
  return kind === "page" || kind === "commit" ? kind : "file";
}

function buildId(kind: string, target: string, locator: string | undefined): string {
  return locator ? `${kind}:${target}#${locator}` : `${kind}:${target}`;
}
