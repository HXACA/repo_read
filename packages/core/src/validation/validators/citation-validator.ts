import type { CitationRecord } from "../../types/generation.js";
import type { ValidationReport } from "../../types/validation.js";

export function validateCitations(
  citations: CitationRecord[],
  knownFiles: string[],
  knownPages: string[],
  pageSlug: string,
): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fileSet = new Set(knownFiles);
  const pageSet = new Set(knownPages);

  if (citations.length === 0) {
    warnings.push(`${pageSlug}: no citations — page may lack evidence basis`);
    return { target: "page", passed: true, errors, warnings };
  }

  for (const c of citations) {
    if (c.kind === "file" && !fileSet.has(c.target)) {
      errors.push(`${pageSlug}: citation references unknown file "${c.target}"`);
    }
    if (c.kind === "page" && !pageSet.has(c.target)) {
      errors.push(`${pageSlug}: citation references unknown page "${c.target}"`);
    }
  }

  return { target: "page", passed: errors.length === 0, errors, warnings };
}
