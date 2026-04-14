import { describe, it, expect } from "vitest";
import { buildPageDraftUserPrompt } from "../page-drafter-prompt.js";
import type { MainAuthorContext } from "../../types/agent.js";
import type { PageDraftPromptInput } from "../page-drafter-prompt.js";

function makeContext(overrides: Partial<MainAuthorContext> = {}): MainAuthorContext {
  return {
    project_summary: "A TypeScript monorepo",
    full_book_summary: "Covers architecture and internals",
    published_page_summaries: [],
    evidence_ledger: [],
    ...overrides,
  };
}

const baseInput: PageDraftPromptInput = {
  slug: "test-page",
  title: "Test Page",
  order: 1,
  coveredFiles: ["src/index.ts"],
  language: "en",
};

describe("kind-aware drafting", () => {
  describe("guide kind", () => {
    it("contains onboarding/overview direction", () => {
      const ctx = makeContext({ page_kind: "guide" });
      const prompt = buildPageDraftUserPrompt(ctx, baseInput);
      expect(prompt).toContain("Page Kind: Guide");
      expect(prompt).toContain("newcomer");
      expect(prompt).toContain("cognitive map");
      expect(prompt).toContain("onboarding");
    });
  });

  describe("explanation kind", () => {
    it("contains mechanism/trade-off direction", () => {
      const ctx = makeContext({ page_kind: "explanation" });
      const prompt = buildPageDraftUserPrompt(ctx, baseInput);
      expect(prompt).toContain("Page Kind: Explanation");
      expect(prompt).toContain("mechanisms");
      expect(prompt).toContain("design trade-offs");
    });
  });

  describe("reference kind", () => {
    it("contains high-density/structured direction", () => {
      const ctx = makeContext({ page_kind: "reference" });
      const prompt = buildPageDraftUserPrompt(ctx, baseInput);
      expect(prompt).toContain("Page Kind: Reference");
      expect(prompt).toContain("High-density");
      expect(prompt).toContain("tables");
      expect(prompt).toContain("looking things up");
    });
  });

  describe("appendix kind", () => {
    it("contains long-tail/supplementary direction", () => {
      const ctx = makeContext({ page_kind: "appendix" });
      const prompt = buildPageDraftUserPrompt(ctx, baseInput);
      expect(prompt).toContain("Page Kind: Appendix");
      expect(prompt).toContain("Long-tail");
      expect(prompt).toContain("supplementary");
    });
  });

  describe("missing/unknown kind", () => {
    it("falls back to explanation behavior when kind is undefined", () => {
      const ctx = makeContext({ page_kind: undefined });
      const prompt = buildPageDraftUserPrompt(ctx, baseInput);
      expect(prompt).toContain("Page Kind: Explanation");
      expect(prompt).toContain("mechanisms");
    });

    it("falls back to explanation behavior when kind is unknown string", () => {
      const ctx = makeContext({ page_kind: "unknown-kind" });
      const prompt = buildPageDraftUserPrompt(ctx, baseInput);
      expect(prompt).toContain("Page Kind: Explanation");
    });

    it("does not crash when page_kind is not provided", () => {
      const ctx = makeContext();
      expect(() => buildPageDraftUserPrompt(ctx, baseInput)).not.toThrow();
    });
  });

  describe("reader_goal", () => {
    it("appears in the prompt when provided", () => {
      const ctx = makeContext({
        page_kind: "guide",
        reader_goal: "set up a local development environment in under 10 minutes",
      });
      const prompt = buildPageDraftUserPrompt(ctx, baseInput);
      expect(prompt).toContain("Reader Goal");
      expect(prompt).toContain("The reader should be able to: set up a local development environment in under 10 minutes");
    });

    it("is absent from the prompt when not provided", () => {
      const ctx = makeContext({ page_kind: "guide" });
      const prompt = buildPageDraftUserPrompt(ctx, baseInput);
      expect(prompt).not.toContain("Reader Goal");
    });
  });

  describe("previous/next page slugs", () => {
    it("includes both previous and next when provided", () => {
      const ctx = makeContext({
        page_kind: "explanation",
        previous_page_slug: "getting-started",
        next_page_slug: "advanced-config",
      });
      const prompt = buildPageDraftUserPrompt(ctx, baseInput);
      expect(prompt).toContain("Page Navigation Context");
      expect(prompt).toContain("follows 'getting-started'");
      expect(prompt).toContain("precedes 'advanced-config'");
    });

    it("includes only previous when next is absent", () => {
      const ctx = makeContext({
        page_kind: "appendix",
        previous_page_slug: "last-chapter",
      });
      const prompt = buildPageDraftUserPrompt(ctx, baseInput);
      expect(prompt).toContain("follows 'last-chapter'");
      expect(prompt).not.toContain("precedes");
    });

    it("includes only next when previous is absent", () => {
      const ctx = makeContext({
        page_kind: "guide",
        next_page_slug: "first-chapter",
      });
      const prompt = buildPageDraftUserPrompt(ctx, baseInput);
      expect(prompt).toContain("precedes 'first-chapter'");
      expect(prompt).not.toContain("follows");
    });

    it("is absent when neither previous nor next is provided", () => {
      const ctx = makeContext({ page_kind: "guide" });
      const prompt = buildPageDraftUserPrompt(ctx, baseInput);
      expect(prompt).not.toContain("Page Navigation Context");
    });
  });
});
