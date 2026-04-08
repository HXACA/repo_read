import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { WikiJson } from "../types/generation.js";

export async function persistCatalog(
  storage: StorageAdapter,
  projectSlug: string,
  jobId: string,
  versionId: string,
  wiki: WikiJson,
): Promise<void> {
  const filePath = storage.paths.draftWikiJson(projectSlug, jobId, versionId);
  await storage.writeJson(filePath, wiki);
}
