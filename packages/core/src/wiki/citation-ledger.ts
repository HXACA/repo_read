import type { CitationRecord } from "../types/generation.js";
import type { StorageAdapter } from "../storage/storage-adapter.js";

export type PageCitations = {
  pageSlug: string;
  citations: CitationRecord[];
};

export class CitationLedger {
  private pages: Map<string, CitationRecord[]> = new Map();

  addPage(pageSlug: string, citations: CitationRecord[]): void {
    this.pages.set(pageSlug, citations);
  }

  getForPage(pageSlug: string): CitationRecord[] {
    return this.pages.get(pageSlug) ?? [];
  }

  getAll(): PageCitations[] {
    return Array.from(this.pages.entries()).map(([pageSlug, citations]) => ({
      pageSlug,
      citations,
    }));
  }

  findByTarget(target: string): Array<{ pageSlug: string; citation: CitationRecord }> {
    const results: Array<{ pageSlug: string; citation: CitationRecord }> = [];
    for (const [pageSlug, citations] of this.pages) {
      for (const c of citations) {
        if (c.target === target) {
          results.push({ pageSlug, citation: c });
        }
      }
    }
    return results;
  }

  async loadFromVersion(
    storage: StorageAdapter,
    projectSlug: string,
    versionId: string,
    pageSlugs: string[],
  ): Promise<void> {
    for (const slug of pageSlugs) {
      const citations = await storage.readJson<CitationRecord[]>(
        storage.paths.versionCitationsJson(projectSlug, versionId, slug),
      );
      if (citations) {
        this.addPage(slug, citations);
      }
    }
  }
}
