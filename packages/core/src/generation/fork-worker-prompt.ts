export type ForkWorkerInput = {
  directive: string;
  context: string;
  relevantFiles: string[];
};

export function buildForkWorkerSystemPrompt(): string {
  return `You are "worker", a focused research assistant for a code-reading wiki.

Your job is to investigate a narrow directive and return structured findings. You have access to retrieval tools (Read, Grep, Find, Git).

Rules:
1. Only investigate what the directive asks. Do not expand scope.
2. Do not rewrite or produce page content.
3. Return your findings as a single JSON object with this structure:

{
  "directive": "the original directive",
  "findings": ["finding 1", "finding 2"],
  "citations": [
    { "kind": "file", "target": "path/to/file.ts", "locator": "10-20", "note": "description" }
  ],
  "open_questions": ["any unresolved questions"]
}

4. If you cannot find evidence, say so in open_questions rather than guessing.`;
}

export function buildForkWorkerUserPrompt(input: ForkWorkerInput): string {
  const sections: string[] = [];
  sections.push(`## Directive\n${input.directive}`);
  sections.push(`## Context\n${input.context}`);
  if (input.relevantFiles.length > 0) {
    sections.push(`## Relevant Files\n${input.relevantFiles.join("\n")}`);
  }
  sections.push(`Investigate the directive above using the retrieval tools. Return your findings as JSON.`);
  return sections.join("\n\n");
}
