import type { WikiJson } from "../types/generation.js";
import type { ValidationReport } from "../types/validation.js";

const MAX_PAGES = 50;
const MIN_PAGES = 2;

export function validateCatalog(wiki: WikiJson): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!wiki.summary || wiki.summary.trim().length === 0) {
    errors.push("Missing or empty summary");
  }

  if (!wiki.reading_order || !Array.isArray(wiki.reading_order)) {
    errors.push("Missing or invalid reading_order array");
    return { target: "wiki", passed: false, errors, warnings };
  }

  if (wiki.reading_order.length === 0) {
    errors.push("Empty reading_order — at least 2 pages required");
    return { target: "wiki", passed: false, errors, warnings };
  }

  if (wiki.reading_order.length < MIN_PAGES) {
    errors.push(`Too few pages: ${wiki.reading_order.length}, minimum is ${MIN_PAGES}`);
  }

  if (wiki.reading_order.length > MAX_PAGES) {
    errors.push(`Too many pages: ${wiki.reading_order.length}, maximum is ${MAX_PAGES}`);
  }

  const slugs = new Set<string>();
  for (let i = 0; i < wiki.reading_order.length; i++) {
    const page = wiki.reading_order[i];
    const prefix = `Page ${i + 1}`;
    if (!page.slug || page.slug.trim().length === 0) {
      errors.push(`${prefix}: empty slug`);
    } else if (slugs.has(page.slug)) {
      errors.push(`${prefix}: duplicate slug "${page.slug}"`);
    } else {
      slugs.add(page.slug);
    }
    if (!page.title || page.title.trim().length === 0) {
      errors.push(`${prefix} (${page.slug}): empty title`);
    }
    if (!page.covered_files || page.covered_files.length === 0) {
      warnings.push(`${prefix} (${page.slug}): empty covered_files — page may lack evidence basis`);
    }
  }

  return { target: "wiki", passed: errors.length === 0, errors, warnings };
}
