import { describe, it, expect } from "vitest";
import { classifyRoute } from "../route-classifier.js";
import type { PageMeta } from "../../types/generation.js";

// Minimal page meta for testing
const pageMeta: PageMeta = {
  slug: "api-endpoints",
  title: "API Endpoints",
  order: 5,
  sectionId: "api-endpoints",
  coveredFiles: ["src/api/routes.ts", "src/api/middleware.ts"],
  relatedPages: ["architecture"],
  generatedAt: "2026-04-11",
  commitHash: "abc123",
  citationFile: "citations/api-endpoints.citations.json",
  summary: "API endpoint definitions and middleware",
  reviewStatus: "accepted",
  reviewSummary: "No blockers",
  reviewDigest: "{}",
  status: "validated",
  validation: {
    structurePassed: true,
    mermaidPassed: true,
    citationsPassed: true,
    linksPassed: true,
    summary: "passed",
  },
};

const wiki = {
  summary: "A web framework",
  reading_order: [
    { slug: "overview", title: "Overview", rationale: "Start here", covered_files: ["README.md"] },
    { slug: "api-endpoints", title: "API Endpoints", rationale: "API layer", covered_files: ["src/api/routes.ts"] },
  ],
};

describe("route classifier regression", () => {
  describe("page-first: simple questions stay on page", () => {
    const cases = [
      "What does this page explain?",
      "Explain the middleware in this section",
      "What is mentioned above about routes?",
      "What does handleRequest mean here?",
    ];
    for (const q of cases) {
      it(`"${q}" → page-first`, () => {
        expect(classifyRoute({
          question: q,
          currentPageSlug: "api-endpoints",
          pageMeta,
          wiki,
        })).toBe("page-first");
      });
    }
  });

  describe("page-plus-retrieval: mentions covered files", () => {
    const cases = [
      "How does src/api/routes.ts handle authentication?",
      "What does middleware.ts export?",
    ];
    for (const q of cases) {
      it(`"${q}" → page-plus-retrieval`, () => {
        expect(classifyRoute({
          question: q,
          currentPageSlug: "api-endpoints",
          pageMeta,
          wiki,
        })).toBe("page-plus-retrieval");
      });
    }
  });

  describe("research: broad questions upgrade to research", () => {
    const cases = [
      "How does the authentication compare to the authorization?",
      "What is the overall architecture of this project?",
      "Explain the architecture end to end",
      "Trace a request through the entire system",
      "What are all the configuration options?",
      "List every API endpoint in the project",
      "Deep dive into the error handling strategy",
    ];
    for (const q of cases) {
      it(`"${q}" → research`, () => {
        expect(classifyRoute({
          question: q,
          currentPageSlug: "api-endpoints",
          pageMeta,
          wiki,
        })).toBe("research");
      });
    }
  });

  describe("no page context defaults", () => {
    it("defaults to research when no page context", () => {
      expect(classifyRoute({
        question: "How does error handling work?",
      })).toBe("research");
    });

    it("defaults to page-plus-retrieval when on a page", () => {
      expect(classifyRoute({
        question: "How does error handling work?",
        currentPageSlug: "api-endpoints",
        pageMeta,
        wiki,
      })).toBe("page-plus-retrieval");
    });
  });
});
