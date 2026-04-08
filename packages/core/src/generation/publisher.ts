import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { WikiJson, VersionJson } from "../types/generation.js";

export class Publisher {
  constructor(private readonly storage: StorageAdapter) {}

  async publish(
    projectSlug: string,
    jobId: string,
    versionId: string,
    wiki: WikiJson,
    commitHash: string,
  ): Promise<void> {
    const versionJson: VersionJson = {
      versionId,
      projectSlug,
      commitHash,
      createdAt: new Date().toISOString(),
      pageCount: wiki.reading_order.length,
      pages: wiki.reading_order.map((page, idx) => ({
        slug: page.slug,
        title: page.title,
        order: idx + 1,
        status: "published" as const,
      })),
      summary: wiki.summary,
    };

    await this.storage.writeJson(
      this.storage.paths.draftVersionJson(projectSlug, jobId, versionId),
      versionJson,
    );

    await this.storage.promoteVersion(projectSlug, jobId, versionId);

    await this.storage.writeJson(this.storage.paths.currentJson, {
      projectSlug,
      versionId,
      updatedAt: new Date().toISOString(),
    });
  }
}
