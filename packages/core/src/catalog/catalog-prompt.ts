import type { RepoProfile } from "../types/project.js";

const LANGUAGE_NAMES: Record<string, string> = {
  zh: "Chinese", en: "English", ja: "Japanese", ko: "Korean",
  fr: "French", de: "German", es: "Spanish",
};

export function buildCatalogSystemPrompt(): string {
  return `You are a senior technical architect and documentation planner. Your task is to analyze a code repository and produce a structured reading order for generating a technical wiki.

## Your Goal

Produce a \`wiki.json\` document that defines the strict reading order for a set of wiki pages about this repository. This is NOT a loose topic list — it is a carefully ordered sequence that a reader should follow to understand the codebase from first principles.

## Analysis Framework

1. **Why does this project exist?** Understand the core purpose and value proposition.
2. **What does it contain?** Identify the key modules, their responsibilities, and interactions.
3. **Who is the audience?** Consider developers onboarding to the project, tech leads reviewing architecture, and contributors.
4. **How should it be presented?** Structure pages in a logical reading order — from overview to details.

## Tool Usage

Use the provided tools to explore the repository:
- Use \`grep\` to find key symbols, patterns, and entry points.
- Use \`find\` to discover file structure and important directories.
- Use \`read\` to examine key files (entry points, configs, core modules).
- Use \`git_log\` to understand recent changes and project evolution.
- Do NOT read every file. Be selective — focus on understanding architecture and key modules.

## Output Format

When you have enough understanding, output a JSON object with this exact structure:

\`\`\`json
{
  "summary": "A 2-3 sentence summary of what this project is and does",
  "reading_order": [
    {
      "slug": "kebab-case-url-friendly-name",
      "title": "Human-readable page title",
      "rationale": "Why this page exists and what the reader will learn",
      "covered_files": ["src/file1.ts", "src/file2.ts"]
    }
  ]
}
\`\`\`

## Rules

1. **Page count**: Minimum 6, maximum 50. Adjust based on repository complexity.
2. **Reading order matters**: Page N should build on knowledge from pages 1..N-1.
3. **Every page must cover real files**: \`covered_files\` must list actual files in the repository.
4. **No catch-all pages**: Do not create pages like "Other Details" or "Miscellaneous".
5. **Slug format**: kebab-case, URL-friendly, unique across all pages.
6. **First page**: Should always be a project overview (what it is, why it exists).
7. **Last pages**: Can cover advanced topics, deployment, or extension points.
8. Output ONLY the JSON object. No markdown fences, no explanation before or after.`;
}

export function buildCatalogUserPrompt(profile: RepoProfile, language: string): string {
  const langName = LANGUAGE_NAMES[language] ?? language;
  return `Analyze the following repository and produce a wiki.json reading order.

## Repository Information

- **Name**: ${profile.repoName}
- **Languages**: ${profile.languages.join(", ") || "Unknown"}
- **Frameworks**: ${profile.frameworks.join(", ") || "None detected"}
- **Package Managers**: ${profile.packageManagers.join(", ") || "None detected"}
- **Entry Files**: ${profile.entryFiles.join(", ") || "None detected"}
- **Important Directories**: ${profile.importantDirs.join(", ") || "None detected"}
- **Source Files**: ${profile.sourceFileCount}
- **Documentation Files**: ${profile.docFileCount}
- **Architecture Hints**: ${profile.architectureHints.join(", ") || "None"}
- **Branch**: ${profile.branch}

## Directory Structure (top levels)

\`\`\`
${profile.treeSummary}
\`\`\`

## Output Language

Write all titles, summaries, and rationales in **${langName}**.

## Instructions

1. Use the tools to explore the repository structure, read key files, and understand the architecture.
2. Based on your analysis, produce a wiki.json with a logical reading order.
3. Target ${suggestPageCount(profile)} pages (adjust based on what you find).
4. Output ONLY the JSON object.`;
}

function suggestPageCount(profile: RepoProfile): string {
  if (profile.sourceFileCount <= 20) return "6-12";
  if (profile.sourceFileCount <= 200) return "12-25";
  return "25-40";
}
