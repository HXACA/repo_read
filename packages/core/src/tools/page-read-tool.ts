import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { PageMeta } from "../types/generation.js";

export type PageReadResult = {
  success: boolean;
  markdown?: string;
  meta?: PageMeta;
  error?: string;
};

/**
 * Read a published page's Markdown and metadata.
 * Stub for M3 — will be fully implemented in M4 when pages exist.
 */
export async function pageRead(
  storage: StorageAdapter,
  projectSlug: string,
  versionId: string,
  pageSlug: string,
): Promise<PageReadResult> {
  const mdPath = storage.paths.versionPageMd(projectSlug, versionId, pageSlug);
  const metaPath = storage.paths.versionPageMeta(projectSlug, versionId, pageSlug);

  // Read markdown as raw text (not JSON)
  let markdown: string | undefined;
  try {
    const fs = await import("node:fs/promises");
    markdown = await fs.readFile(mdPath, "utf-8");
  } catch {
    // not found
  }

  const meta = await storage.readJson<PageMeta>(metaPath);

  if (!markdown && !meta) {
    return { success: false, error: `Page "${pageSlug}" not found in version ${versionId}` };
  }

  return { success: true, markdown, meta: meta ?? undefined };
}
