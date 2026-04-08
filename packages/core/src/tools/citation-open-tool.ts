import type { CitationRecord } from "../types/generation.js";
import { readFile } from "./read-tool.js";

export type CitationOpenResult = {
  success: boolean;
  citation: CitationRecord;
  content?: string;
  error?: string;
};

/**
 * Resolve a citation to its source content.
 * For M3, only file citations are supported.
 */
export async function citationOpen(
  repoRoot: string,
  citation: CitationRecord,
): Promise<CitationOpenResult> {
  if (citation.kind === "file") {
    let offset = 0;
    let limit = 300;
    if (citation.locator) {
      const match = citation.locator.match(/^L(\d+)(?:-L(\d+))?$/);
      if (match) {
        offset = parseInt(match[1], 10) - 1;
        const endLine = match[2] ? parseInt(match[2], 10) : offset + 50;
        limit = endLine - offset;
      }
    }
    const filePath = `${repoRoot}/${citation.target}`;
    const result = await readFile(filePath, { offset, limit });
    return { success: result.success, citation, content: result.content, error: result.error };
  }
  return { success: false, citation, error: `Citation kind "${citation.kind}" not yet supported in M3` };
}
