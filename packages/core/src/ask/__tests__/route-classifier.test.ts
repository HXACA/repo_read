import { describe, it, expect } from "vitest";
import { classifyRoute } from "../route-classifier.js";

describe("classifyRoute", () => {
  it("returns page-first for page-specific questions", () => {
    const route = classifyRoute({
      question: "What does this section explain?",
      currentPageSlug: "overview",
      pageMeta: { slug: "overview", coveredFiles: ["src/index.ts"] } as never,
    });
    expect(route).toBe("page-first");
  });

  it("returns page-plus-retrieval when mentioning covered file", () => {
    const route = classifyRoute({
      question: "How does src/engine.ts handle errors?",
      currentPageSlug: "core",
      pageMeta: { slug: "core", coveredFiles: ["src/engine.ts"] } as never,
    });
    expect(route).toBe("page-plus-retrieval");
  });

  it("returns research for broad questions", () => {
    const route = classifyRoute({
      question: "Explain the architecture of the entire system",
    });
    expect(route).toBe("research");
  });

  it("returns page-plus-retrieval as default when on a page", () => {
    const route = classifyRoute({
      question: "What is the config format?",
      currentPageSlug: "config",
      pageMeta: { slug: "config", coveredFiles: ["config.ts"] } as never,
    });
    expect(route).toBe("page-plus-retrieval");
  });

  it("returns research when not on any page", () => {
    const route = classifyRoute({
      question: "What is the config format?",
    });
    expect(route).toBe("research");
  });
});
