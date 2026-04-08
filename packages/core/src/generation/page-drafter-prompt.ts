import type { MainAuthorContext } from "../types/agent.js";

export type PageDraftPromptInput = {
  slug: string;
  title: string;
  order: number;
  coveredFiles: string[];
  language: string;
};

export function buildPageDraftSystemPrompt(): string {
  return `You are "main.author", the primary technical writer for a code-reading wiki.

Your task is to write a single wiki page as high-quality Markdown. You have access to retrieval tools (Read, Grep, Find, Git) to inspect the repository.

Rules:
1. Write in the specified language. Use clear, technical prose.
2. Every factual claim must be backed by evidence from the repository.
3. Include inline citations in the format: [cite:kind:target:locator] where kind is file/page/commit.
   Example: [cite:file:src/engine.ts:42-60]
4. Structure the page with a title (# heading), a brief summary paragraph, then detailed sections.
5. Use code blocks with language tags for code snippets.
6. Use Mermaid diagrams (in \`\`\`mermaid blocks) when they help explain architecture or flow.
7. Do not duplicate content from previously published pages — reference them with [cite:page:slug].
8. Stay within the scope of the current page plan. Do not cover topics assigned to other pages.
9. At the end, output a JSON block with your citations and summary:

\`\`\`json
{
  "summary": "One-paragraph summary of this page",
  "citations": [
    { "kind": "file", "target": "path/to/file.ts", "locator": "42-60", "note": "Engine constructor" }
  ],
  "related_pages": ["setup", "cli"]
}
\`\`\``;
}

export function buildPageDraftUserPrompt(
  context: MainAuthorContext,
  input: PageDraftPromptInput,
): string {
  const sections: string[] = [];

  sections.push(`## Project Summary\n${context.project_summary}`);
  sections.push(`## Full Book Summary\n${context.full_book_summary}`);

  if (context.current_page_plan) {
    sections.push(`## Current Page Plan\n${context.current_page_plan}`);
  }

  sections.push(
    `## Page Assignment`,
    `- **Title:** ${input.title}`,
    `- **Slug:** ${input.slug}`,
    `- **Order:** Page ${input.order} in the reading order`,
    `- **Language:** ${input.language}`,
    `- **Covered Files:** ${input.coveredFiles.join(", ")}`,
  );

  if (context.published_page_summaries.length > 0) {
    sections.push(`## Previously Published Pages`);
    for (const page of context.published_page_summaries) {
      sections.push(`- **${page.title}** (${page.slug}): ${page.summary}`);
    }
  }

  if (context.evidence_ledger.length > 0) {
    sections.push(`## Evidence Ledger (already collected)`);
    for (const entry of context.evidence_ledger) {
      sections.push(`- [${entry.kind}] ${entry.target}: ${entry.note}`);
    }
  }

  sections.push(
    `## Instructions`,
    `Write the complete wiki page for "${input.title}". Use the retrieval tools to read the covered files and gather evidence. Then produce the page as Markdown with inline citations. End with the JSON metadata block.`,
  );

  return sections.join("\n\n");
}
