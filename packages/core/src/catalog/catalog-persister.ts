import type { ArtifactStore } from "../artifacts/artifact-store.js";
import type { WikiJson } from "../types/generation.js";

export async function persistCatalog(
  artifactStore: ArtifactStore,
  projectSlug: string,
  jobId: string,
  versionId: string,
  wiki: WikiJson,
): Promise<void> {
  await artifactStore.saveWikiJson({ projectSlug, jobId, versionId }, wiki);
}
