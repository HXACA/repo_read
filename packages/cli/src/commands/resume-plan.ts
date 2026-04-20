import type { WikiJson, PageMeta } from "@reporead/core";

export interface ResumePlan {
  skipPageSlugs: Set<string>;
  recoveredCommitHash: string | null;
  alreadyDone: number;
  remaining: number;
  publishOnly: boolean;
}

/**
 * Pure resume-plan computation: walk the recorded reading order and decide
 * which pages can be skipped on a --resume run.
 *
 * A page is skippable if its PageMeta file on disk declares
 * `status === "validated"`. Anything else (missing file, "drafting",
 * "rejected", truncated) must be re-drafted. `recoveredCommitHash` returns
 * the commit hash from the first validated page so later pages stay
 * consistent with the original run's basis.
 *
 * `publishOnly` is the interesting edge case: every page is already
 * validated but the process died before Publisher.publish() ran. The
 * pipeline handles that state (it skips all page workflows and drops
 * straight into publishing), so callers should forward to the pipeline
 * rather than bailing.
 */
export async function buildResumePlan(
  wiki: WikiJson,
  loadPageMeta: (pageSlug: string) => Promise<PageMeta | null>,
): Promise<ResumePlan> {
  const skipPageSlugs = new Set<string>();
  let recoveredCommitHash: string | null = null;
  for (const page of wiki.reading_order) {
    const meta = await loadPageMeta(page.slug);
    if (meta && meta.status === "validated") {
      skipPageSlugs.add(page.slug);
      if (!recoveredCommitHash && meta.commitHash) {
        recoveredCommitHash = meta.commitHash;
      }
    }
  }
  const alreadyDone = skipPageSlugs.size;
  const remaining = wiki.reading_order.length - alreadyDone;
  return {
    skipPageSlugs,
    recoveredCommitHash,
    alreadyDone,
    remaining,
    publishOnly: remaining === 0,
  };
}
