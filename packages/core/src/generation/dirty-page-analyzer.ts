export type DirtyPageAnalysisInput = {
  changedFiles: string[];
  wiki: { reading_order: Array<{ slug: string; covered_files: string[] }> };
};

export type DirtyPageAnalysis = {
  dirtyPages: string[];       // slugs of pages that need regeneration
  unaffectedPages: string[];  // slugs of pages that can be skipped
};

/**
 * First-version dirty page analysis: a page is dirty if any of its
 * covered_files appears in the changedFiles list.
 *
 * Does NOT do adjacency propagation, summary dependency tracking,
 * or cross-page duplicate inference. Those are for future versions.
 */
export function analyzeDirtyPages(input: DirtyPageAnalysisInput): DirtyPageAnalysis {
  const changedSet = new Set(input.changedFiles);
  const dirtyPages: string[] = [];
  const unaffectedPages: string[] = [];

  for (const page of input.wiki.reading_order) {
    const isDirty = page.covered_files.some(f => changedSet.has(f));
    if (isDirty) {
      dirtyPages.push(page.slug);
    } else {
      unaffectedPages.push(page.slug);
    }
  }

  return { dirtyPages, unaffectedPages };
}
