import type { ValidationReport } from "../../types/validation.js";

export function validateLinks(
  markdown: string,
  knownPages: string[],
  pageSlug: string,
): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const pageSet = new Set(knownPages);

  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(markdown)) !== null) {
    const target = match[2].trim();

    // Skip external URLs and anchor links
    if (target.startsWith("http://") || target.startsWith("https://") || target.startsWith("#")) {
      continue;
    }

    // Internal page reference
    if (!pageSet.has(target)) {
      errors.push(`${pageSlug}: link to unknown page "${target}"`);
    }
  }

  return { target: "page", passed: errors.length === 0, errors, warnings };
}
