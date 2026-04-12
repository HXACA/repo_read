import { describe, it, expect } from "vitest";
import { buildPageDraftSystemPrompt, buildPageDraftUserPrompt } from "../page-drafter-prompt.js";
import type { MainAuthorContext } from "../../types/agent.js";

describe("buildPageDraftSystemPrompt", () => {
  it("includes role and citation format instructions", () => {
    const prompt = buildPageDraftSystemPrompt();
    expect(prompt).toContain("drafter");
    expect(prompt).toContain("citation");
    expect(prompt).toContain("Markdown");
  });
});

describe("buildPageDraftUserPrompt", () => {
  const context: MainAuthorContext = {
    project_summary: "A TypeScript monorepo for wiki generation",
    full_book_summary: "Covers setup, core engine, and CLI",
    current_page_plan: "Explain the core engine architecture",
    published_page_summaries: [
      { slug: "setup", title: "Setup Guide", summary: "How to install and configure" },
    ],
    evidence_ledger: [
      { id: "e1", kind: "file", target: "src/engine.ts", note: "Main engine class" },
    ],
  };

  it("includes page plan in prompt", () => {
    const prompt = buildPageDraftUserPrompt(context, {
      slug: "core-engine",
      title: "Core Engine",
      order: 2,
      coveredFiles: ["src/engine.ts", "src/pipeline.ts"],
      language: "en",
    });
    expect(prompt).toContain("Core Engine");
    expect(prompt).toContain("src/engine.ts");
    expect(prompt).toContain("src/pipeline.ts");
    expect(prompt).toContain("Explain the core engine architecture");
  });

  it("includes published page summaries", () => {
    const prompt = buildPageDraftUserPrompt(context, {
      slug: "core-engine",
      title: "Core Engine",
      order: 2,
      coveredFiles: ["src/engine.ts"],
      language: "en",
    });
    expect(prompt).toContain("Setup Guide");
    expect(prompt).toContain("How to install and configure");
  });

  it("includes evidence ledger", () => {
    const prompt = buildPageDraftUserPrompt(context, {
      slug: "core-engine",
      title: "Core Engine",
      order: 2,
      coveredFiles: ["src/engine.ts"],
      language: "en",
    });
    expect(prompt).toContain("src/engine.ts");
    expect(prompt).toContain("Main engine class");
  });
});
