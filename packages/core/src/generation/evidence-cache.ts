/**
 * Evidence cache key model — foundation for repo-level evidence caching.
 *
 * Keys are deterministic, content-addressed triples:
 *   (projectSlug, fileHash, queryClass)
 *
 * The serialized form is used as the filename inside
 * `.reporead/cache/evidence/`.
 */

export type EvidenceCacheKey = {
  projectSlug: string;
  fileHash: string;      // content hash of the source file
  queryClass: string;    // e.g. "evidence-collection", "outline-planning"
};

/**
 * Produce a deterministic string suitable for use as a cache filename stem.
 */
export function serializeEvidenceCacheKey(key: EvidenceCacheKey): string {
  return `${key.projectSlug}::${key.fileHash}::${key.queryClass}`;
}

/**
 * Convenience factory — keeps call-sites from constructing object literals.
 */
export function buildEvidenceCacheKey(
  projectSlug: string,
  fileHash: string,
  queryClass: string,
): EvidenceCacheKey {
  return { projectSlug, fileHash, queryClass };
}
