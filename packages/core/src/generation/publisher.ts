import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { WikiJson, VersionJson } from "../types/generation.js";
import { ProjectModel } from "../project/project-model.js";

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
        section: page.section,
        group: page.group,
        level: page.level,
        kind: page.kind,
      })),
      summary: wiki.summary,
    };

    await this.storage.writeJson(
      this.storage.paths.draftVersionJson(projectSlug, jobId, versionId),
      versionJson,
    );

    await this.storage.promoteVersion(projectSlug, jobId, versionId);

    // Update global pointer
    await this.storage.writeJson(this.storage.paths.currentJson, {
      projectSlug,
      versionId,
      updatedAt: new Date().toISOString(),
    });

    // Update project.json with latestVersionId
    const projectModel = new ProjectModel(this.storage);
    try {
      await projectModel.update(projectSlug, { latestVersionId: versionId });
    } catch {
      // Best-effort: project.json may not exist if created externally
    }
  }
}
