import type { ValidationReport } from "../../types/validation.js";

const MIN_CONTENT_LENGTH = 100;

export function validateStructure(markdown: string, pageSlug: string): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!markdown || markdown.trim().length === 0) {
    errors.push(`${pageSlug}: empty page content`);
    return { target: "page", passed: false, errors, warnings };
  }

  const lines = markdown.trim().split("\n");
  const firstNonEmpty = lines.find((l) => l.trim().length > 0);

  if (!firstNonEmpty || !firstNonEmpty.startsWith("# ")) {
    errors.push(`${pageSlug}: missing H1 title — page must start with "# Title"`);
  }

  if (markdown.trim().length < MIN_CONTENT_LENGTH) {
    warnings.push(`${pageSlug}: content is very short (${markdown.trim().length} chars) — may lack substance`);
  }

  return { target: "page", passed: errors.length === 0, errors, warnings };
}
