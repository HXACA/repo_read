import type { ValidationReport } from "../../types/validation.js";

const VALID_DIAGRAM_TYPES = [
  "graph", "flowchart", "sequenceDiagram", "classDiagram",
  "stateDiagram", "erDiagram", "gantt", "pie", "gitgraph",
  "mindmap", "timeline", "quadrantChart", "sankey",
  "xychart", "block", "packet", "kanban", "architecture",
];

export function validateMermaid(markdown: string, pageSlug: string): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const mermaidRegex = /```mermaid\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let blockIndex = 0;

  while ((match = mermaidRegex.exec(markdown)) !== null) {
    blockIndex++;
    const content = match[1].trim();

    if (content.length === 0) {
      errors.push(`${pageSlug}: mermaid block ${blockIndex} is empty`);
      continue;
    }

    const firstLine = content.split("\n")[0].trim();
    const hasDiagramType = VALID_DIAGRAM_TYPES.some((t) =>
      firstLine.startsWith(t),
    );

    if (!hasDiagramType) {
      errors.push(`${pageSlug}: mermaid block ${blockIndex} missing diagram type keyword (e.g., graph, sequenceDiagram)`);
    }
  }

  return { target: "page", passed: errors.length === 0, errors, warnings };
}
