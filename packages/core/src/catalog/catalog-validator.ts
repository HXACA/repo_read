import type { WikiJson } from "../types/generation.js";
import type { ValidationReport } from "../types/validation.js";
import { isPageKind } from "../book/page-kind.js";

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

    // Book schema: kind validation (warning, not error)
    if (!page.kind) {
      warnings.push(`${prefix} (${page.slug}): missing kind — should be guide/explanation/reference/appendix`);
    } else if (!isPageKind(page.kind)) {
      warnings.push(`${prefix} (${page.slug}): invalid kind "${page.kind}" — must be guide/explanation/reference/appendix`);
    }

    // Book schema: readerGoal validation (warning, not error)
    if (!page.readerGoal || page.readerGoal.trim().length === 0) {
      warnings.push(`${prefix} (${page.slug}): missing readerGoal — each page should state what the reader gains`);
    }
  }

  // Book schema: structural ordering warnings
  if (wiki.reading_order.length > 0) {
    const firstPage = wiki.reading_order[0];
    if (firstPage.kind && firstPage.kind !== "guide") {
      warnings.push(`First page should be kind "guide", got "${firstPage.kind}"`);
    }

    // appendix should not appear in the first 20% of pages
    const twentyPercentIndex = Math.ceil(wiki.reading_order.length * 0.2);
    for (let i = 0; i < twentyPercentIndex; i++) {
      const page = wiki.reading_order[i];
      if (page.kind === "appendix") {
        warnings.push(`Page ${i + 1} (${page.slug}): appendix should not appear in the first 20% of pages`);
      }
    }

    // reference should not appear before the first explanation
    let firstExplanationIndex = -1;
    for (let i = 0; i < wiki.reading_order.length; i++) {
      if (wiki.reading_order[i].kind === "explanation") {
        firstExplanationIndex = i;
        break;
      }
    }
    if (firstExplanationIndex >= 0) {
      for (let i = 0; i < firstExplanationIndex; i++) {
        if (wiki.reading_order[i].kind === "reference") {
          warnings.push(`Page ${i + 1} (${wiki.reading_order[i].slug}): reference should not appear before the first explanation page`);
        }
      }
    }
  }

  return { target: "wiki", passed: errors.length === 0, errors, warnings };
}
