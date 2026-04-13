import { describe, it, expect } from "vitest";
import { buildCatalogSystemPrompt, buildCatalogUserPrompt } from "../catalog-prompt.js";
import type { RepoProfile } from "../../types/project.js";

const mockProfile: RepoProfile = {
  projectSlug: "test-project",
  repoRoot: "/tmp/repo",
  repoName: "test-project",
  branch: "main",
  commitHash: "abc123",
  languages: ["TypeScript", "JavaScript"],
  frameworks: ["Next.js"],
  packageManagers: ["pnpm"],
  entryFiles: ["src/index.ts"],
  importantDirs: ["src", "lib"],
  ignoredPaths: ["node_modules", ".git"],
  sourceFileCount: 42,
  docFileCount: 5,
  treeSummary: "src/\n  index.ts\n  utils.ts\nlib/\n  core.ts",
  architectureHints: ["monorepo"],
};

describe("buildCatalogSystemPrompt", () => {
  it("includes role definition", () => {
    const prompt = buildCatalogSystemPrompt();
    expect(prompt).toContain("expert software engineer");
    expect(prompt).toContain("reading_order");
  });

  it("includes output format instructions", () => {
    const prompt = buildCatalogSystemPrompt();
    expect(prompt).toContain("covered_files");
    expect(prompt).toContain("reading_order");
  });

  it("includes section and group rules", () => {
    const prompt = buildCatalogSystemPrompt();
    expect(prompt).toContain("section");
    expect(prompt).toContain("group");
  });
});

describe("buildCatalogUserPrompt", () => {
  it("includes repo profile data", () => {
    const prompt = buildCatalogUserPrompt(mockProfile, "en");
    expect(prompt).toContain("test-project");
    expect(prompt).toContain("TypeScript");
    expect(prompt).toContain("Next.js");
    expect(prompt).toContain("src/index.ts");
  });

  it("includes tree summary", () => {
    const prompt = buildCatalogUserPrompt(mockProfile, "en");
    expect(prompt).toContain("src/");
    expect(prompt).toContain("index.ts");
  });

  it("includes language instruction", () => {
    const zhPrompt = buildCatalogUserPrompt(mockProfile, "zh");
    expect(zhPrompt).toContain("Chinese");
    const enPrompt = buildCatalogUserPrompt(mockProfile, "en");
    expect(enPrompt).toContain("English");
  });
});
