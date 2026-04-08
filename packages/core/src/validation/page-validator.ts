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

export function validatePage(input: PageValidationInput): ValidationReport {
  const reports = [
    validateStructure(input.markdown, input.pageSlug),
    validateCitations(input.citations, input.knownFiles, input.knownPages, input.pageSlug),
    validateMermaid(input.markdown, input.pageSlug),
    validateLinks(input.markdown, input.knownPages, input.pageSlug),
  ];

  const errors = reports.flatMap((r) => r.errors);
  const warnings = reports.flatMap((r) => r.warnings);

  return {
    target: "page",
    passed: errors.length === 0,
    errors,
    warnings,
  };
}
