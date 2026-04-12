import type { CitationRecord } from "../types/generation.js";
import type { ValidationReport } from "../types/validation.js";
import { validateStructure } from "./validators/structure-validator.js";
import { validateCitations } from "./validators/citation-validator.js";
import { validateMermaid } from "./validators/mermaid-validator.js";
import { validateLinks } from "./validators/link-validator.js";

export type PageValidationInput = {
  markdown: string;
  citations: CitationRecord[];
  knownFiles: string[];
  knownPages: string[];
  pageSlug: string;
};

/**
 * Scan each `##` section of the markdown and return a warning for any
 * section that contains zero `[cite:` inline citations.
 */
function checkCitationDensity(markdown: string, pageSlug: string): string[] {
  const warnings: string[] = [];

  // Split into sections by `##` headings (ignore the `#` title heading).
  // Each element after split[0] starts right after a `##`.
  const sectionSplits = markdown.split(/^## /m);

  // sectionSplits[0] is everything before the first `##` — skip it.
  for (let i = 1; i < sectionSplits.length; i++) {
    const sectionText = sectionSplits[i];
    // Extract the heading (first line of the split chunk)
    const headingMatch = sectionText.match(/^(.+)/);
    const heading = headingMatch ? headingMatch[1].trim() : `(section ${i})`;

    const citeCount = (sectionText.match(/\[cite:/g) || []).length;
    if (citeCount === 0) {
      warnings.push(
        `warning: [${pageSlug}] section "${heading}" has zero citations`,
      );
    }
  }

  return warnings;
}

export function validatePage(input: PageValidationInput): ValidationReport {
  const reports = [
    validateStructure(input.markdown, input.pageSlug),
    validateCitations(input.citations, input.knownFiles, input.knownPages, input.pageSlug),
    validateMermaid(input.markdown, input.pageSlug),
    validateLinks(input.markdown, input.knownPages, input.pageSlug),
  ];

  const errors = reports.flatMap((r) => r.errors);
  const warnings = reports.flatMap((r) => r.warnings);

  // Citation density check — warn for sections with no citations
  warnings.push(...checkCitationDensity(input.markdown, input.pageSlug));

  return {
    target: "page",
    passed: errors.length === 0,
    errors,
    warnings,
  };
}
